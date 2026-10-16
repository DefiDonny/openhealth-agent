import {NextRequest} from "next/server";
import fs from "fs/promises";
import {auth} from "@/auth";

export async function GET(
    req: NextRequest,
    {params}: { params: Promise<{ filename: string }> }
) {
    // Uploads are private health data — require a logged-in session.
    const session = await auth()
    if (!session?.user) {
        return new Response('Unauthorized', {status: 401})
    }

    const {filename} = await params

    if (!filename.match(/^[a-zA-Z0-9-_]+\.(pdf|png|jpe?g)$/)) {
        return new Response('Invalid filename', {status: 400})
    }

    const filePath = `./public/uploads/${filename}`
    const file = await fs.readFile(filePath)

    // Response blob
    return new Response(file, {
        headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename=${filename}`
        }
    })
}
