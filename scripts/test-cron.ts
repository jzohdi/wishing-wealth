import "dotenv/config";

// const BASE_URL = "http://localhost:3000";
const BASE_URL = "https://wishing-wealth.vercel.app";
const SECRET = process.env.CRON_SECRET;

if (!SECRET) {
    console.error("CRON_SECRET is not set in environment");
    process.exit(1);
}

async function main() {
    const url = `${BASE_URL}/api/cron`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${SECRET}` },
    });
    const text = await res.text();
    console.log(res.status, text);
    if (!res.ok) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
