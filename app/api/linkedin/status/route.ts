import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { encrypt } from '@/lib/encryption';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
        return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
    }

    const resultPath = path.join(os.tmpdir(), `linkedin-session-${sessionId}.json`);

    if (fs.existsSync(resultPath)) {
        try {
            const data = fs.readFileSync(resultPath, 'utf8');
            const result = JSON.parse(data);

            // Cleanup
            fs.unlinkSync(resultPath);

            if (result.status === 'success') {
                const { cookie } = result;

                try {
                    // Encrypt cookie
                    const li_at_encrypted = encrypt(cookie);
                    const id = uuidv4();
                    const userId = 'demo-user'; // Hardcoded for now

                    // Store in DB
                    const insertQuery = db.prepare(`
                      INSERT INTO linkedin_accounts (id, user_id, li_at_encrypted)
                      VALUES (?, ?, ?)
                    `);

                    insertQuery.run(id, userId, li_at_encrypted);

                    return NextResponse.json({ status: 'connected' });
                } catch (dbError) {
                    console.error("Database error:", dbError);
                    return NextResponse.json({ status: 'error', message: 'Failed to save account' }, { status: 500 });
                }
            } else {
                return NextResponse.json(result);
            }
        } catch (error) {
            console.error("Error reading session file:", error);
            return NextResponse.json({ status: 'error', message: 'Failed to read session data' }, { status: 500 });
        }
    } else {
        return NextResponse.json({ status: 'waiting' });
    }
}
