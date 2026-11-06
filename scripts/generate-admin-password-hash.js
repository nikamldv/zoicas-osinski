"use strict";

const crypto = require("node:crypto");

function readHiddenPassword(prompt) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
        throw new Error("Run this command in an interactive terminal so the password stays hidden.");
    }

    return new Promise((resolve, reject) => {
        let password = "";
        process.stdout.write(prompt);
        process.stdin.setEncoding("utf8");
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const finish = value => {
            process.stdin.off("data", onData);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write("\n");
            resolve(value);
        };

        const onData = chunk => {
            for (const character of chunk) {
                if (character === "\u0003") {
                    process.stdin.off("data", onData);
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.stdout.write("\nCancelled.\n");
                    reject(new Error("Password entry cancelled."));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    finish(password);
                    return;
                }
                if (character === "\u007f" || character === "\b") {
                    password = password.slice(0, -1);
                    continue;
                }
                if (character >= " ") password += character;
            }
        };

        process.stdin.on("data", onData);
    });
}

async function main() {
    try {
        const password = await readHiddenPassword("Dashboard password (at least 14 characters): ");
        if (password.length < 14 || password.length > 256) {
            throw new Error("Use a password between 14 and 256 characters.");
        }

        const salt = crypto.randomBytes(16);
        const derived = await new Promise((resolve, reject) => {
            crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key));
        });

        process.stdout.write(`ADMIN_PASSWORD_HASH=scrypt$${salt.toString("hex")}$${derived.toString("hex")}\n`);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}

main();
