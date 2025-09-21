import { readFileSync } from "fs";
import { join } from "path";
import { extractPriceFromHtml } from "../trading-view";

async function main() {
    const htmlPath = join(
        process.cwd(),
        "src/server/scrape/examples/trading-view.html",
    );
    const html = readFileSync(htmlPath, "utf8");
    const price = extractPriceFromHtml({
        html,
        url: "file://src/server/scrape/examples/trading-view.html",
    });

    if (!Number.isFinite(price)) {
        throw new Error(
            `extractPriceFromHtml returned non-finite value: ${price}`,
        );
    }

    // Accept either real-time trade price or daily close from the example snapshot
    const expectedCandidates = [191.5, 190.23];
    const matches = expectedCandidates.some((v) => Math.abs(price - v) < 1e-6);
    if (!matches) {
        throw new Error(
            `Unexpected price ${price}. Expected one of: ${
                expectedCandidates.join(", ")
            }`,
        );
    }

    console.log("extractPriceFromHtml OK", { price });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
