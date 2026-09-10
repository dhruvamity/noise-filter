import { NextRequest, NextResponse } from 'next/server';
import { appendFile, mkdir, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const LOG_PATH = join(process.cwd(), 'data', 'regime-log.jsonl');

/**
 * Server-side JSONL log for regime calls.
 *
 * On Vercel's serverless runtime the filesystem is ephemeral — writes survive
 * within a single function invocation but not across cold starts. This route
 * is fully functional for `next start` / Docker / VPS deployments. On Vercel
 * the browser's IndexedDB + JSON/CSV export remains the durable path; the
 * server POST silently succeeds (best-effort) without affecting the user.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const line = JSON.stringify({ ...body, _serverTs: new Date().toISOString() }) + '\n';
    await mkdir(dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, line, 'utf-8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('regime-log POST error:', err);
    return NextResponse.json({ error: 'Failed to write log entry' }, { status: 500 });
  }
}

export async function GET() {
  try {
    await access(LOG_PATH);
    const content = await readFile(LOG_PATH, 'utf-8');
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': 'attachment; filename="regime-log.jsonl"',
      },
    });
  } catch {
    return new NextResponse('', {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': 'attachment; filename="regime-log.jsonl"',
      },
    });
  }
}
