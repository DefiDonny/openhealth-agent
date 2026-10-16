import {NextRequest, NextResponse} from "next/server";
import {auth} from "@/auth";

// Authenticated relay to the local whoop-sync service.
// The sync service trusts localhost or an X-Sync-Key header only; the browser
// never talks to it directly except for the OAuth vendor callbacks.
const SERVICE_URL = process.env.SYNC_SERVICE_URL || "http://127.0.0.1:3001";

function serviceHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (process.env.SYNC_API_KEY) headers["x-sync-key"] = process.env.SYNC_API_KEY;
    return headers;
}

async function requireUser() {
    const session = await auth();
    return session?.user ? session : null;
}

export async function GET(
    req: NextRequest,
    {params}: { params: Promise<{ provider: string, action: string }> }
) {
    const {provider, action} = await params;
    if (!["whoop", "withings"].includes(provider) || !["status", "connect"].includes(action)) {
        return NextResponse.json({error: "not found"}, {status: 404});
    }
    if (!await requireUser()) {
        return NextResponse.json({error: "unauthorized"}, {status: 401});
    }

    const upstream = await fetch(`${SERVICE_URL}/api/${provider}/${action}`, {
        headers: serviceHeaders(),
        redirect: "manual",
    });

    // Connect flow: relay the OAuth redirect to the vendor.
    if (action === "connect" && upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get("location");
        if (location) return NextResponse.redirect(new URL(location));
    }

    const body = await upstream.text();
    return new NextResponse(body, {
        status: upstream.status,
        headers: {"content-type": upstream.headers.get("content-type") || "application/json"},
    });
}

export async function POST(
    req: NextRequest,
    {params}: { params: Promise<{ provider: string, action: string }> }
) {
    const {provider, action} = await params;
    if (!["whoop", "withings"].includes(provider) || action !== "sync") {
        return NextResponse.json({error: "not found"}, {status: 404});
    }
    if (!await requireUser()) {
        return NextResponse.json({error: "unauthorized"}, {status: 401});
    }

    const upstream = await fetch(`${SERVICE_URL}/api/${provider}/sync`, {
        method: "POST",
        headers: serviceHeaders(),
    });
    const body = await upstream.text();
    return new NextResponse(body, {
        status: upstream.status,
        headers: {"content-type": upstream.headers.get("content-type") || "application/json"},
    });
}
