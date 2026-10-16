import prisma, {Prisma} from "@/lib/prisma";
import {NextRequest, NextResponse} from "next/server";
// parseHealthData removed - using direct Claude Vision pipeline
import crypto from "node:crypto";
import {fileTypeFromBuffer} from "file-type";
import sharp from 'sharp'
import {auth} from "@/auth";
// vercel blob removed for self-hosted
// deployment env not needed for self-hosted
import fs from 'fs'

export interface HealthData extends Prisma.HealthDataGetPayload<{
    select: {
        id: true,
        type: true,
        data: true,
        metadata: true,
        status: true,
        fileType: true,
        filePath: true,
        createdAt: true,
        updatedAt: true,
    }
}> {
    id: string
}

export interface HealthDataCreateRequest {
    id?: string;
    type: string;
    data: Prisma.InputJsonValue;
    filePath?: string | null;
    fileType?: string | null;
}

export interface HealthDataListResponse {
    healthDataList: HealthData[]
}

export interface HealthDataCreateResponse extends HealthData {
    id: string;
}

export async function POST(
    req: NextRequest
) {
    const session = await auth()
    if (!session || !session.user) return NextResponse.json({error: 'Unauthorized'}, {status: 401})

    const contentType = req.headers.get('content-type')
    if (!contentType) {
        return NextResponse.json({error: 'Missing content-type header'}, {status: 400})
    }

    if (contentType === 'application/json') {
        const data: HealthDataCreateRequest = await req.json()
        const healthData = await prisma.healthData.create({
            data: {...data, authorId: session.user.id}
        })
        return NextResponse.json<HealthDataCreateResponse>(healthData)
    } else {
        const formData = await req.formData()
        const file = formData.get('file')
        const id = formData.get('id')

        // Vision Parser

        // Document Parser

        let filePath: string | undefined
        let fileType: string | undefined
        let baseData: { fileName: string } | undefined = undefined

        // Save files
        if (file instanceof File) {
            const fileBuffer = Buffer.from(await file.arrayBuffer())
            const result = await fileTypeFromBuffer(fileBuffer)
            if (!result) return NextResponse.json({error: 'Failed to determine file type'}, {status: 400})

            // Get file hash
            const hash = crypto.createHash('md5')
            hash.update(fileBuffer)
            const fileHash = hash.digest('hex')

            const {mime} = result
            if (mime.startsWith('image/')) {
                const outputBuffer = await sharp(fileBuffer).png().toBuffer()
                const filename = `${fileHash}.png`;
                if (true) {
                    fs.writeFileSync(`./public/uploads/${filename}`, outputBuffer)
                    filePath = `/api/static/uploads/${filename}`
                }
                fileType = 'image/png'
                baseData = {fileName: file.name}
            } else {
                if (true) {
                    const extension = file.name.split('.').pop()
                    const filename = `${fileHash}.${extension}`;
                    fs.writeFileSync(`./public/uploads/${filename}`, fileBuffer)
                    filePath = `/api/static/uploads/${filename}`
                }
                fileType = mime
                baseData = {fileName: file.name}
            }
        }

        // Create parsing data
        let healthData;
        try {
            healthData = await prisma.healthData.create({
                data: {
                    id: id ? id as string : undefined,
                    type: 'FILE',
                    status: 'PARSING',
                    filePath: filePath,
                    fileType: fileType,
                    data: baseData ? {...baseData} : {},
                    authorId: session.user.id,
                },
            });

            // ===== SIMPLE DOCUMENT PROCESSING (Claude Vision) =====
            // Read the uploaded file
            const uploadedFileBuffer = fs.readFileSync(`./public/uploads/${filePath?.split('/').pop()}`);
            const uploadedFileType = await fileTypeFromBuffer(uploadedFileBuffer);
            const uploadedMime = uploadedFileType?.mime || fileType || 'application/octet-stream';
            
            // Convert to images
            const imageBase64List: string[] = [];
            if (uploadedMime === 'application/pdf') {
                // PDF: convert each page to PNG using pdf2pic
                const {fromBuffer: pdf2picFromBuffer} = await import('pdf2pic');
                const converter = pdf2picFromBuffer(uploadedFileBuffer, {preserveAspectRatio: true});
                const pages = await converter.bulk(-1, {responseType: 'base64'});
                for (const page of pages) {
                    if (page.base64) imageBase64List.push(page.base64);
                }
            } else if (uploadedMime.startsWith('image/')) {
                imageBase64List.push(uploadedFileBuffer.toString('base64'));
            }

            // Send each image to Claude Vision for text extraction
            const parsingLogs: string[] = [];
            let extractedText = '';
            const anthropicKey = process.env.ANTHROPIC_API_KEY;
            
            for (let i = 0; i < imageBase64List.length; i++) {
                try {
                    const mediaType = uploadedMime === 'application/pdf' ? 'image/png' : uploadedMime;
                    const response = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': anthropicKey || '',
                            'anthropic-version': '2023-06-01'
                        },
                        body: JSON.stringify({
                            model: 'claude-sonnet-4-20250514',
                            max_tokens: 4096,
                            messages: [{
                                role: 'user',
                                content: [
                                    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64List[i] }},
                                    { type: 'text', text: 'Extract ALL medical test results, health data, and clinical information from this document. For each test result include: test name, result value, unit, and reference range. Also extract patient info, dates, doctor name, hospital/clinic name. Return as structured text.' }
                                ]
                            }]
                        })
                    });
                    const result = await response.json() as {content?: Array<{text?: string}>, error?: {message?: string}};
                    if (result.content?.[0]?.text) {
                        extractedText += (i > 0 ? '\n\n--- Page ' + (i+1) + ' ---\n\n' : '') + result.content[0].text;
                        parsingLogs.push('Page ' + (i+1) + ': extracted ' + result.content[0].text.length + ' chars');
                    } else if (result.error) {
                        parsingLogs.push('Page ' + (i+1) + ' error: ' + (result.error.message || JSON.stringify(result.error)));
                    }
                } catch (pageError) {
                    parsingLogs.push('Page ' + (i+1) + ' error: ' + (pageError as Error).message);
                }
            }

            // Build the final data object
            const parsedData = {
                fileName: baseData?.fileName || 'Unknown',
                extractedText: extractedText,
                parsingLogs: parsingLogs,
                pageCount: imageBase64List.length,
                parsedAt: new Date().toISOString()
            };

            healthData = await prisma.healthData.update({
                where: {id: healthData.id},
                data: {
                    status: extractedText ? 'COMPLETED' : 'FAILED',
                    data: parsedData as Prisma.InputJsonValue,
                },
            });
            return NextResponse.json(healthData);
        } catch (error) {
            console.error('Error processing file:', error);
            const parsingLogs: string[] = []
            parsingLogs.push(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // If there's an error, update the health data with error logs
            if (healthData) {
                healthData = await prisma.healthData.update({
                    where: {id: healthData.id},
                    data: {
                        status: 'COMPLETED',
                        data: {...baseData, parsingLogs},
                    }
                });
                return NextResponse.json(healthData);
            }
            return NextResponse.json({error: 'Failed to process file'}, {status: 500});
        }
    }
}

export async function GET() {
    const session = await auth()
    if (!session || !session.user) return NextResponse.json({error: 'Unauthorized'}, {status: 401})

    // Create personal info if it doesn't exist
    const personalInfo = await prisma.healthData.findFirst({where: {authorId: session.user.id, type: 'PERSONAL_INFO'}})
    if (personalInfo === null) {
        await prisma.healthData.create({
            data: {type: 'PERSONAL_INFO', authorId: session.user.id, data: {}}
        })
    }

    const healthDataList = await prisma.healthData.findMany({
        where: {authorId: session.user.id},
        orderBy: {createdAt: 'asc'}
    })
    return NextResponse.json<HealthDataListResponse>({
        healthDataList: healthDataList
    })

}
