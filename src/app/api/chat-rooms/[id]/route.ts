import prisma from "@/lib/prisma";
import {NextRequest, NextResponse} from "next/server";
import {ChatRoom} from "@/app/api/chat-rooms/route";
import {auth} from "@/auth";

export interface ChatRoomPatchRequest {
    assistantModeId: string
}

export interface ChatRoomPatchResponse {
    chatRoom: ChatRoom
}

export interface ChatRoomGetResponse {
    chatRoom: ChatRoom
}

// Every route here requires a signed-in user who owns the room.
async function ownedRoom(userId: string, id: string) {
    return prisma.chatRoom.findFirst({
        where: {id, authorId: userId},
        select: {id: true}
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
    const owned = await ownedRoom(userId, id)
    if (!owned) return NextResponse.json({error: 'Chat room not found'}, {status: 404})

    const chatRoom = await prisma.chatRoom.findUnique({
        where: {id},
        select: {
            id: true,
            name: true,
            assistantMode: {
                select: {
                    id: true,
                    name: true,
                    description: true,
                    systemPrompt: true
                }
            },
            llmProviderId: true,
            llmProviderModelId: true,
            createdAt: true,
            lastActivityAt: true
        }
    });

    if (!chatRoom) return NextResponse.json({error: 'Chat room not found'}, {status: 404})

    return NextResponse.json<ChatRoomGetResponse>({chatRoom})
}

export async function PATCH(
    req: NextRequest,
    {params}: { params: Promise<{ id: string }> }
) {
    const session = await auth()
    const user = session?.user
    const userId = user?.id
    if (!session || !user || !userId) return NextResponse.json({error: 'Unauthorized'}, {status: 401})

    const {id} = await params
    const owned = await ownedRoom(userId, id)
    if (!owned) return NextResponse.json({error: 'Chat room not found'}, {status: 404})

    const body: ChatRoomPatchRequest = await req.json()

    const chatRoom = await prisma.chatRoom.update({
        where: {id},
        data: {assistantModeId: body.assistantModeId},
        select: {
            id: true,
            name: true,
            assistantMode: {
                select: {
                    id: true,
                    name: true,
                    description: true,
                    systemPrompt: true
                }
            },
            llmProviderId: true,
            llmProviderModelId: true,
            createdAt: true,
            lastActivityAt: true
        }
    });

    return NextResponse.json<ChatRoomPatchResponse>({
        chatRoom
    })
}

export async function DELETE(request: Request, {params}: {
    params: Promise<{ id: string }>
}) {
    const session = await auth()
    const user = session?.user
    const userId = user?.id
    if (!session || !user || !userId) return NextResponse.json({error: 'Unauthorized'}, {status: 401})

    const {id} = await params;
    const owned = await ownedRoom(userId, id)
    if (!owned) return NextResponse.json({error: 'Chat room not found'}, {status: 404})

    await prisma.chatRoom.delete({
        where: {id}
    });

    return new NextResponse(null, {status: 204});
}
