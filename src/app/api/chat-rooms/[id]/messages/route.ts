/* eslint-disable @typescript-eslint/no-explicit-any */
import {NextRequest, NextResponse} from "next/server";
import prisma, {Prisma} from "@/lib/prisma";
import {auth} from "@/auth";
import {decrypt} from "@/lib/encryption";
import {currentDeploymentEnv} from "@/lib/current-deployment-env";
import {ChatOpenAI} from "@langchain/openai";
import {ChatAnthropic} from "@langchain/anthropic";
import {ChatGoogleGenerativeAI} from "@langchain/google-genai";
import fs from "fs";
import path from "path";

export interface ChatMessage extends Prisma.ChatMessageGetPayload<{
    select: {
        id: true,
        content: true,
        createdAt: true,
        role: true,
        attachments: true
    }
}> {
    id: string,
}

export interface ChatMessageListResponse {
    chatMessages: ChatMessage[]
}

export interface ChatMessageCreateRequest {
    content: string,
    role: 'USER' | 'ASSISTANT',
    attachments?: Array<{url: string, mime?: string, name?: string}>,
    settings?: {
        company: string,
        model: string,
        apiEndpoint: string,
        apiKey: string
    }
}

function blockToDataUrl(url: string): string | null {
    try {
        const name = (url || '').split('/').pop() || '';
        if (!name) return null;
        const full = path.join(process.cwd(), 'public', 'uploads', name);
        if (!fs.existsSync(full)) return null;
        const buf = fs.readFileSync(full);
        const ext = (name.split('.').pop() || '').toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        return 'data:' + mime + ';base64,' + buf.toString('base64');
    } catch {
        return null;
    }
}

function toOllamaMessages(msgs: any[]): any[] {
    return msgs.map((m: any) => {
        if (typeof m.content === 'string') return m;
        const texts = m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text);
        const images = m.content
            .filter((b: any) => b.type === 'image_url' && b.image_url && b.image_url.url)
            .map((b: any) => String(b.image_url.url).split(',')[1])
            .filter(Boolean);
        return {role: m.role, content: texts.join('\n'), images: images};
    });
}

export async function GET(
    req: NextRequest,
    {params}: { params: Promise<{ id: string }> }
) {
    const session = await auth()
    const user = session?.user
    const userId = user?.id
    if (!session || !user || !userId) return NextResponse.json({error: 'Unauthorized'}, {status: 401})

    const {id} = await params
    const owned = await prisma.chatRoom.findFirst({
        where: {id, authorId: userId},
        select: {id: true}
    })
    if (!owned) return NextResponse.json({error: 'Chat room not found'}, {status: 404})

    const chatMessages = await prisma.chatMessage.findMany({
        where: {chatRoomId: id},
        orderBy: {createdAt: 'asc'}
    });

    return NextResponse.json<ChatMessageListResponse>({chatMessages})
}

export async function POST(
    req: NextRequest,
    {params}: {
        params: Promise<{ id: string }>,
    }
) {
    const session = await auth()
    const user = session?.user
    const userId = user?.id
    if (!session || !user || !userId) return NextResponse.json({error: 'Unauthorized'}, {status: 401})

    const {id} = await params
    const owned = await prisma.chatRoom.findFirst({
        where: {id, authorId: userId},
        select: {id: true}
    })
    if (!owned) return NextResponse.json({error: 'Chat room not found'}, {status: 404})

    const body: ChatMessageCreateRequest = await req.json()

    const {
        chatRoom,
        assistantMode,
        chatMessages,
        healthDataList,
        llmProvider
    } = await prisma.$transaction(async (prisma) => {
        await prisma.chatMessage.create({data: {content: body.content, role: body.role, chatRoomId: id, attachments: body.attachments && body.attachments.length > 0 ? body.attachments : undefined}});
        const {assistantMode} = await prisma.chatRoom.update({
            where: {id},
            data: {lastActivityAt: new Date()},
            select: {assistantMode: {select: {systemPrompt: true}}}
        })
        const chatMessages = await prisma.chatMessage.findMany({
            where: {chatRoomId: id},
            orderBy: {createdAt: 'asc'}
        })
        const healthDataList = await prisma.healthData.findMany({where: {authorId: user.id}})
        const chatRoom = await prisma.chatRoom.findUniqueOrThrow({where: {id}})
        const llmProvider = await prisma.lLMProvider.findUniqueOrThrow({where: {id: chatRoom.llmProviderId}});
        return {
            chatRoom,
            chatMessages,
            assistantMode,
            healthDataList,
            llmProvider
        }
    })

    let apiKey: string
    if (currentDeploymentEnv === 'local') {
        apiKey = decrypt(llmProvider.apiKey)
    } else if (currentDeploymentEnv === 'cloud') {
        switch (llmProvider.providerId) {
            case 'openai':
                apiKey = process.env.OPENAI_API_KEY as string
                break;
            case 'anthropic':
                apiKey = process.env.ANTHROPIC_API_KEY as string
                break;
            case 'google':
                apiKey = process.env.GOOGLE_API_KEY as string
                break;
            default:
                throw new Error('Unsupported LLM provider');
        }
    }

    // Only the most recent few image-bearing turns are re-sent to the model, to bound token cost.
    const imageEligible = new Set<number>();
    {
        const withImages: number[] = [];
        chatMessages.forEach((m, i) => {
            const a: any[] = Array.isArray((m as any).attachments) ? (m as any).attachments : [];
            if (m.role === 'USER' && a.length > 0) withImages.push(i);
        });
        withImages.slice(-4).forEach((i) => imageEligible.add(i));
    }

    const messages = [
        {"role": "system" as const, "content": assistantMode.systemPrompt},
        {
            "role": "user" as const,
            "content": `Health data sources: ${healthDataList.map((healthData) => `${healthData.type}: ${JSON.stringify(healthData.data)}`).join('\n')}`
        },
        ...chatMessages.map((message, idx) => {
            const role = message.role.toLowerCase() as 'user' | 'assistant';
            const atts: any[] = Array.isArray((message as any).attachments) ? (message as any).attachments : [];
            if (role === 'user' && atts.length > 0 && imageEligible.has(idx)) {
                const blocks: any[] = [];
                if (message.content) blocks.push({type: 'text', text: message.content});
                for (const a of atts) {
                    const dataUrl = blockToDataUrl(a && a.url ? a.url : '');
                    if (dataUrl) blocks.push({type: 'image_url', image_url: {url: dataUrl}});
                }
                if (blocks.some((b) => b.type === 'image_url')) {
                    return {role: role, content: blocks};
                }
            }
            return {role: role, content: message.content};
        })
    ]

    const responseStream = new ReadableStream({
        async start(controller) {
            let messageContent = '';

            try {
                if (llmProvider.providerId === 'ollama') {
                    const response = await fetch(`${llmProvider.apiURL}/api/chat`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            model: chatRoom.llmProviderModelId,
                            messages: toOllamaMessages(messages),
                            stream: true,
                        }),
                    });

                    const reader = response.body?.getReader();
                    if (!reader) throw new Error('No reader available');

                    while (true) {
                        const {done, value} = await reader.read();
                        if (done) break;

                        const chunk = new TextDecoder().decode(value);
                        const lines = chunk.split('\n').filter(line => line.trim());

                        for (const line of lines) {
                            if (line.includes('[DONE]')) continue;
                            try {
                                const json = JSON.parse(line);
                                const content = json.message?.content;
                                if (content) {
                                    messageContent += content;
                                    controller.enqueue(`${JSON.stringify({content: messageContent})}\n`);
                                }
                            } catch (e) {
                                console.error('Error parsing JSON:', e);
                            }
                        }
                    }
                } else if (llmProvider.providerId === 'openai') {
                    // OpenAI API call
                    const llmProviderModelId = chatRoom.llmProviderModelId;
                    if (!llmProviderModelId) throw new Error('No LLM model ID provided');
                    const openai = new ChatOpenAI({
                        apiKey,
                        model: llmProviderModelId,
                        configuration: {baseURL: llmProvider.apiURL},
                        streaming: true,
                    }).withConfig({metadata: {chatRoomId: id}, runName: 'chat'})

                    const chatStream = await openai.stream(messages)
                    for await (const part of chatStream) {
                        const deltaContent = part.content.toString()
                        if (deltaContent !== undefined) messageContent += deltaContent;
                        controller.enqueue(`${JSON.stringify({content: messageContent})}\n`);
                    }
                } else if (llmProvider.providerId === 'anthropic') {
                    const llmProviderModelId = chatRoom.llmProviderModelId;
                    if (!llmProviderModelId) throw new Error('No LLM model ID provided');
                    const anthropic = new ChatAnthropic({
                        apiKey,
                        anthropicApiUrl: llmProvider.apiURL,
                        model: llmProviderModelId,
                        maxTokens: 4096,
                        topP: undefined,
                    }).withConfig({metadata: {chatRoomId: id}, runName: 'chat'})

                    const chatStream = await anthropic.stream(messages)
                    for await (const part of chatStream) {
                        const deltaContent = part.content.toString()
                        if (deltaContent !== undefined) messageContent += deltaContent;
                        controller.enqueue(`${JSON.stringify({content: messageContent})}\n`);
                    }
                } else if (llmProvider.providerId == 'google') {
                    const llmProviderModelId = chatRoom.llmProviderModelId;
                    if (!llmProviderModelId) throw new Error('No LLM model ID provided');
                    const gemini = new ChatGoogleGenerativeAI({
                        apiKey,
                        model: llmProviderModelId
                    }).withConfig({metadata: {chatRoomId: id}, runName: 'chat'})

                    const chatStream = await gemini.stream(messages)
                    for await (const part of chatStream) {
                        const deltaContent = part.content.toString()
                        if (deltaContent !== undefined) messageContent += deltaContent;
                        controller.enqueue(`${JSON.stringify({content: messageContent})}\n`);
                    }
                } else {
                    throw new Error('Unsupported LLM provider');
                }

                // Save to prisma after the stream is done
                await prisma.$transaction(async (prisma) => {
                    await prisma.chatMessage.create({
                        data: {
                            content: messageContent,
                            role: 'ASSISTANT',
                            chatRoomId: id
                        }
                    });
                    await prisma.chatRoom.update({
                        where: {id}, data: {lastActivityAt: new Date(), name: messageContent}
                    })
                });
            } catch (error) {
                console.error('Error in chat stream:', error);
                controller.enqueue(`${JSON.stringify({error: 'Failed to get response from LLM'})}\n`);
            }

            controller.close();
        }
    });

    return new NextResponse(responseStream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
