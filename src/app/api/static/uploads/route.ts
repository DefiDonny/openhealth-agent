import {NextResponse} from "next/server";
import {auth} from "@/auth";
import fs from "fs";
import crypto from "node:crypto";

export async function POST(request: Request): Promise<NextResponse> {
    const session = await auth();
    if (!session || !session.user) {
        return NextResponse.json({error: "Unauthorized"}, {status: 401});
    }

    try {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file || !(file instanceof File)) {
            return NextResponse.json({error: "No file provided"}, {status: 400});
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const hash = crypto.createHash("md5").update(buffer).digest("hex");
        const ext = file.name.split(".").pop() || "bin";
        const filename = `${hash}.${ext}`;

        fs.writeFileSync(`./public/uploads/${filename}`, buffer);

        return NextResponse.json({
            url: `/api/static/uploads/${filename}`,
            downloadUrl: `/api/static/uploads/${filename}`,
            pathname: filename
        });
    } catch (error) {
        return NextResponse.json(
            {error: (error as Error).message},
            {status: 400}
        );
    }
}
