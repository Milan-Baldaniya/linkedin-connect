import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

export async function POST() {
    const sessionId = uuidv4();
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'linkedin-login.js');
    // const scriptPath = path.resolve(process.cwd(), 'scripts', 'test.js');
    const logPath = path.resolve(process.cwd(), 'debug.log');

    const log = (msg: string) => {
        fs.appendFileSync(logPath, `${new Date().toISOString()} - ${msg}\n`);
    };

    log(`Received request for session ${sessionId}`);
    log(`Script path: ${scriptPath}`);

    if (!fs.existsSync(scriptPath)) {
        log(`ERROR: Script not found at ${scriptPath}`);
        return NextResponse.json({ error: 'Script not found' }, { status: 500 });
    }

    try {
        // Create a writable stream to the log file for the child process
        // using os.tmpdir() to ensure write permissions and easy access
        const childLogPath = path.join(os.tmpdir(), `linkedin-spawn-${sessionId}.log`);
        const logStream = fs.openSync(childLogPath, 'a');

        // Use process.execPath to ensure we use the same node binary
        log(`Using Node executable: ${process.execPath}`);
        log(`Redirecting child output to: ${childLogPath}`);

        const child = spawn(process.execPath, [scriptPath, sessionId], {
            detached: true,
            stdio: ['ignore', logStream, logStream], // Pipe stdout and stderr to the log file but keep detached
            cwd: process.cwd()
        });

        log(`Spawning process... PID: ${child.pid}`);

        if (!child.pid) {
            log(`ERROR: Failed to spawn process. No PID returned.`);
            return NextResponse.json({ error: 'Failed to spawn' }, { status: 500 });
        }

        child.unref();
        return NextResponse.json({ sessionId });
    } catch (e: any) {
        log(`EXCEPTION: ${e.message}`);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
