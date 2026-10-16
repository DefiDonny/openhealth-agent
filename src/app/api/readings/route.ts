import {NextRequest, NextResponse} from "next/server";
import {auth} from "@/auth";
import prisma from "@/lib/prisma";

// MANUAL_READINGS: permanent readings from manual entry, CSV import or the
// health agent. No sync ever touches this record — it is append-only history.
//
// Entry shape: { timestamp, date, kind: "bp"|"weight"|..., values: {...},
//                source: "manual"|"agent"|"csv", note? }
//
// Auth: a logged-in session, or the SYNC_API_KEY header for programmatic use
// (agent / automation), same key the whoop-sync service accepts.

const ALLOWED_KINDS = ["weight", "bp", "sleep", "hr", "glucose", "temperature", "other"];
const ALLOWED_SOURCES = ["manual", "agent", "csv"];

async function authorize(req: NextRequest): Promise<string | null> {
    const session = await auth();
    if (session?.user?.id) return session.user.id;
    const key = req.headers.get("x-sync-key");
    if (process.env.SYNC_API_KEY && key === process.env.SYNC_API_KEY) {
        const admin = await prisma.user.findFirst({where: {username: "admin"}, select: {id: true}});
        if (admin) return admin.id;
    }
    return null;
}

export async function GET(req: NextRequest) {
    const userId = await authorize(req);
    if (!userId) return NextResponse.json({error: "unauthorized"}, {status: 401});

    const row = await prisma.healthData.findFirst({where: {authorId: userId, type: "MANUAL_READINGS"}});
    const readings = (row?.data as any)?.readings || [];
    return NextResponse.json({readings, count: readings.length});
}

export async function POST(req: NextRequest) {
    const userId = await authorize(req);
    if (!userId) return NextResponse.json({error: "unauthorized"}, {status: 401});

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({error: "invalid JSON body"}, {status: 400});
    }

    const kind = String(body.kind || "").toLowerCase();
    if (!ALLOWED_KINDS.includes(kind)) {
        return NextResponse.json({error: `kind must be one of: ${ALLOWED_KINDS.join(", ")}`}, {status: 400});
    }
    const values = body.values;
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length === 0) {
        return NextResponse.json({error: "values must be a non-empty object"}, {status: 400});
    }
    const source = ALLOWED_SOURCES.includes(body.source) ? body.source : "manual";
    const timestamp = Number(body.timestamp) || Math.floor(Date.now() / 1000);
    const date = String(body.date || new Date(timestamp * 1000).toISOString().split("T")[0]);
    const note = body.note ? String(body.note).slice(0, 500) : undefined;

    const entry = {timestamp, date, kind, values, source, ...(note ? {note} : {})};

    const existing = await prisma.healthData.findFirst({where: {authorId: userId, type: "MANUAL_READINGS"}});
    let readings: any[] = [];
    if (existing?.data && Array.isArray((existing.data as any).readings)) {
        readings = (existing.data as any).readings;
    }

    // Append with dedupe by timestamp+kind; newer entries win. No trimming.
    const dupIndex = readings.findIndex((r: any) => r.timestamp === entry.timestamp && r.kind === entry.kind);
    if (dupIndex >= 0) {
        readings[dupIndex] = entry;
    } else {
        readings.push(entry);
    }
    readings.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

    const data = {readings, count: readings.length, updated_at: new Date().toISOString()};
    if (existing) {
        await prisma.healthData.update({where: {id: existing.id}, data: {data}});
    } else {
        await prisma.healthData.create({
            data: {
                id: "manual_" + Date.now().toString(36),
                type: "MANUAL_READINGS",
                data,
                authorId: userId,
                status: "COMPLETED",
            }
        });
    }

    return NextResponse.json({success: true, entry, count: readings.length});
}
