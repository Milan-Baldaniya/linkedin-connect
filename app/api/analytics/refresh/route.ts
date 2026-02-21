import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

export async function POST() {
    try {
        const scriptPath = path.join(process.cwd(), 'scripts', 'fetch-post-analytics.ts');

        // Wrap exec in a promise to await completion
        await new Promise<void>((resolve, reject) => {
            // Use npx tsx to run the typescript script directly
            exec(`npx tsx "${scriptPath}"`, { cwd: process.cwd() }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`exec error: ${error}`);
                    reject(error);
                    return;
                }
                console.log(`stdout: ${stdout}`);
                if (stderr) console.error(`stderr: ${stderr}`);
                resolve();
            });
        });

        return NextResponse.json({ success: true, message: "Analytics refreshed successfully" });

    } catch (error) {
        console.error("Failed to refresh analytics:", error);
        return NextResponse.json(
            { success: false, error: "Failed to run analytics script" },
            { status: 500 }
        );
    }
}
