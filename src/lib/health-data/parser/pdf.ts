/* eslint-disable */

import {ChatPromptTemplate} from "@langchain/core/prompts";
import {HealthCheckupSchema, HealthCheckupType} from "@/lib/health-data/parser/schema";
import {fileTypeFromBuffer} from 'file-type';
import {getFileMd5, processBatchWithConcurrency} from "@/lib/health-data/parser/util";
import {getParsePrompt, MessagePayload} from "@/lib/health-data/parser/prompt";
import visions from "@/lib/health-data/parser/vision";
import documents from "@/lib/health-data/parser/document";
// import {put} from "@vercel/blob"; // removed for self-hosted
import {currentDeploymentEnv} from "@/lib/current-deployment-env";
import fs from "node:fs";
import {fromBuffer as pdf2picFromBuffer} from 'pdf2pic'
// import {tasks} from "@trigger.dev/sdk/v3"; // removed for self-hosted
// import type {pdfToImages} from "@/trigger/pdf-to-image"; // removed for self-hosted

interface VisionParserOptions {
    parser: string;
    model: string;
    apiKey: string;
    apiUrl?: string
}

interface DocumentParserOptions {
    parser: string;
    model: string;
    apiKey: string;
}

interface SourceParseOptions {
    file: string;
    visionParser?: VisionParserOptions
    documentParser?: DocumentParserOptions
}

interface InferenceOptions {
    imagePaths: string[],
    excludeImage: boolean,
    excludeText: boolean,
    visionParser: VisionParserOptions
    documentParser: DocumentParserOptions
}



// Universal file reader: handles both URLs and local paths
async function fetchOrRead(pathOrUrl: string): Promise<Response> {
    // Convert /api/static/uploads/ paths to local filesystem paths
    const localMatch = pathOrUrl.match(/\/api\/static\/uploads\/(.+)$/);
    if (localMatch) {
        const localPath = `./public/uploads/${localMatch[1]}`;
        const fs = await import('fs');
        try {
            const buffer = fs.readFileSync(localPath);
            console.log('[PDF] Read local file:', localPath, buffer.length, 'bytes');
            return new Response(buffer);
        } catch (e) {
            console.log('[PDF] Local file not found, falling back to fetch:', pathOrUrl);
        }
    }
    // Fall back to fetch for real URLs
    return fetch(pathOrUrl);
}

// Helper: convert upload URL to local file path for Docling
function urlToLocalPath(urlOrPath: string): string {
    // Convert /api/static/uploads/X to ./public/uploads/X
    const apiMatch = urlOrPath.match(/\/api\/static\/uploads\/(.+)$/);
    if (apiMatch) return `./public/uploads/${apiMatch[1]}`;
    // If it's already a local ./ path, return as-is
    if (urlOrPath.startsWith('./')) return urlOrPath;
    // If it's a data: URI, skip
    if (urlOrPath.startsWith('data:')) return urlOrPath;
    // Extract filename from URL like https://your-domain.example/api/static/uploads/FILENAME
    const match = urlOrPath.match(/\/uploads\/([^?#]+)$/);
    if (match) return `./public/uploads/${match[1]}`;
    return urlOrPath;
}

async function documentOCR({document, documentParser}: { document: string, documentParser: DocumentParserOptions }) {

    // Get the document parser
    const parser = documents.find(e => e.name === documentParser.parser)
    if (!parser) throw new Error('Invalid document parser')

    // Get the ocr result
    const models = await parser.models()
    const model = models.find(e => e.id === documentParser.model)
    if (!model) throw new Error('Invalid document parser model')

    // Get the ocr result
    const {ocr} = await parser.ocr({input: document, model: model, apiKey: documentParser.apiKey})

    return ocr
}

async function documentParse({document, documentParser}: {
    document: string,
    documentParser: DocumentParserOptions
}): Promise<any> {

    // Get the document parser
    const parser = documents.find(e => e.name === documentParser.parser)
    if (!parser) throw new Error('Invalid document parser')

    // Get the ocr result
    const models = await parser.models()
    const model = models.find(e => e.id === documentParser.model)
    if (!model) throw new Error('Invalid document parser model')

    // Get the parse result
    const {document: result} = await parser.parse({input: document, model: model, apiKey: documentParser.apiKey})

    return result
}

async function inference(inferenceOptions: InferenceOptions) {
    const {
        imagePaths,
        excludeImage,
        excludeText,
        visionParser: visionParserOptions,
        documentParser: documentParserOptions
    } = inferenceOptions

    // Extract text data if not excluding text
    const pageDataList: { page_content: string }[] | undefined = !excludeText ? await processBatchWithConcurrency(
        imagePaths,
        async (path) => {
            const {content} = await documentParse({document: urlToLocalPath(path), documentParser: documentParserOptions})
            const {markdown} = content
            return {page_content: markdown}
        },
        2
    ) : undefined

    // Extract image data if not excluding images
    const imageDataList: string[] = !excludeImage ? await processBatchWithConcurrency(
        imagePaths,
        async (path) => {
            const localPath = urlToLocalPath(path);
            let buffer: Buffer;
            if (localPath.startsWith('./') || localPath.startsWith('/')) {
                // Read from local filesystem
                const fs = await import('fs');
                buffer = fs.readFileSync(localPath);
            } else {
                // Fetch from URL
    console.log("[PDF-DEBUG] fetch target at line ~126:", typeof arguments !== "undefined" ? "has args" : "no args");

                const fileResponse = await fetchOrRead(path);
                buffer = Buffer.from(await fileResponse.arrayBuffer());
            }
            return `data:image/png;base64,${buffer.toString('base64')}`;
        },
        4
    ) : []

    // Batch Inputs
    const numPages = pageDataList ? pageDataList.length : imageDataList.length
    const batchInputs: MessagePayload[] = new Array(numPages).fill(0).map((_, i) => ({
        ...(!excludeText && pageDataList ? {context: pageDataList[i].page_content} : {}),
        ...(!excludeImage && imageDataList ? {image_data: imageDataList[i]} : {})
    }))

    // Generate Messages
    const messages = ChatPromptTemplate.fromMessages(getParsePrompt({excludeImage, excludeText}));

    // Select Vision Parser
    const visionParser = visions.find(e => e.name === visionParserOptions.parser)
    if (!visionParser) throw new Error('Invalid vision parser')

    // Get models
    const visionParserModels = await visionParser.models({
        apiUrl: visionParserOptions.apiUrl,
    })
    const visionParserModel = visionParserModels.find(e => e.id === visionParserOptions.model)
    if (!visionParserModel) throw new Error('Invalid vision parser model')

    // Process the batch inputs
    const batchData = await processBatchWithConcurrency(
        batchInputs,
        async (input) => visionParser.parse({
            model: visionParserModel,
            messages: messages,
            input: input,
            apiKey: visionParserOptions.apiKey,
            apiUrl: visionParserOptions.apiUrl,
        }),
        4
    )

    // Merge the results
    const data: { [key: string]: HealthCheckupType } = batchData.reduce((acc, curr, i) => {
        acc[`page_${i}`] = curr;
        return acc;
    }, {} as { [key: string]: HealthCheckupType });

    // Merge Results
    const mergeInfo: { [key: string]: { pages: number[], values: any[] } } = {}

    for (const key of HealthCheckupSchema.shape.test_result.keyof().options) {
        const testFields = [];
        const testPages: number[] = [];
        for (let i = 0; i < numPages; i++) {
            const healthCheckup = data[`page_${i}`]
            const healthCheckupTestResult = healthCheckup.test_result

            if (healthCheckupTestResult.hasOwnProperty(key) && healthCheckupTestResult[key]) {
                testFields.push(healthCheckupTestResult[key])
                testPages.push(i)
            }
        }

        if (testFields.length > 0) {
            mergeInfo[key] = {'pages': testPages, 'values': testFields}
        }
    }

    const mergedTestResult: { [key: string]: any } = {}
    const mergedTestResultPage: { [key: string]: { page: number } } = {}

    // Merge the results
    for (const mergeInfoKey in mergeInfo) {
        const mergeTarget = mergeInfo[mergeInfoKey]
        mergedTestResult[mergeInfoKey] = mergeTarget.values[0]
        mergedTestResultPage[mergeInfoKey] = {
            page: mergeTarget.pages[0] + 1
        }
    }

    let mergeData: any = {}

    // Merge name and date
    for (let i = 0; i < numPages; i++) {
        const healthCheckup = data[`page_${i}`]
        mergeData = {
            ...mergeData,
            ...healthCheckup,
        }
    }

    // Update test_result with merged data
    mergeData['test_result'] = mergedTestResult

    // Create final HealthCheckup object
    const finalHealthCheckup = HealthCheckupSchema.parse(mergeData)

    return {
        finalHealthCheckup: finalHealthCheckup,
        mergedTestResultPage: mergedTestResultPage,
    }
}

/**
 * Convert a document to images
 * - pdf: convert to images
 * - image: nothing
 *
 * @param file
 *
 * @returns {Promise<string[]>} - List of image paths
 */
async function documentToImages({file: filePath}: Pick<SourceParseOptions, 'file'>): Promise<string[]> {
    let fileResponse;
    const localFilePath = urlToLocalPath(filePath);
    if (localFilePath.startsWith('./') || localFilePath.startsWith('/')) {
        const fs = await import('fs');
        const fileBuffer = fs.readFileSync(localFilePath);
        fileResponse = new Response(fileBuffer);
    } else {
    console.log("[PDF-DEBUG] fetch target at line ~247:", typeof arguments !== "undefined" ? "has args" : "no args");

        fileResponse = await fetchOrRead(filePath);
    }
    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer())
    const result = await fileTypeFromBuffer(fileBuffer)
    const fileHash = await getFileMd5(fileBuffer)
    if (!result) throw new Error('Invalid file type')
    const mime = result.mime

    // Convert pdf to images, or use the image as is
    const images: string[] = []
    if (mime === 'application/pdf') {
        if (true) {
            const pdf2picConverter = pdf2picFromBuffer(fileBuffer, {preserveAspectRatio: true})
            for (const image of await pdf2picConverter.bulk(-1, {responseType: 'base64'})) {
                if (image.base64) images.push(`data:image/png;base64,${image.base64}`)
            }
        }
    } else {
        images.push(`data:${mime};base64,${fileBuffer.toString('base64')}`)
    }

    // Write the image data to a file
    const imagePaths = []
    for (let i = 0; i < images.length; i++) {
        if (true) {
            fs.writeFileSync(`./public/uploads/${fileHash}_${i}.png`, Buffer.from(images[i].split(',')[1], 'base64'))
            imagePaths.push(`/api/static/uploads/${fileHash}_${i}.png`)
        }
    }

    return imagePaths
}

/**
 * Parse the health data
 *
 * @param options
 */
export async function parseHealthData(options: SourceParseOptions) {
    const {file: filePath} = options

    // VisionParser
    const visionParser = options.visionParser || {
        parser: 'Anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.OPENAI_API as string
    }

    // Document Parser
    const documentParser = options.documentParser || {
        parser: 'Docling',
        model: 'document-parse',
        apiKey: process.env.UPSTAGE_API_KEY as string
    }

    // prepare images
    console.log('[PDF-DEBUG] documentToImages called with filePath:', filePath);
    const imagePaths = await documentToImages({file: filePath})

    // prepare ocr results
    const ocrResults = await documentOCR({
        document: urlToLocalPath(filePath),
        documentParser: documentParser
    })

    // prepare parse results
    await processBatchWithConcurrency(
        imagePaths,
        async (path) => documentParse({document: urlToLocalPath(path), documentParser: documentParser}),
        3
    )

    // Merge the results
    const baseInferenceOptions = {imagePaths, visionParser, documentParser}
    const [
        {finalHealthCheckup: resultTotal, mergedTestResultPage: resultTotalPages},
        {finalHealthCheckup: resultText, mergedTestResultPage: resultTextPages},
        {finalHealthCheckup: resultImage, mergedTestResultPage: resultImagePages}
    ] = await Promise.all([
        inference({...baseInferenceOptions, excludeImage: false, excludeText: false}),
        inference({...baseInferenceOptions, excludeImage: false, excludeText: true}),
        inference({...baseInferenceOptions, excludeImage: true, excludeText: false}),
    ]);

    const resultDictTotal = resultTotal.test_result
    const resultDictText = resultText.test_result
    const resultDictImage = resultImage.test_result

    const mergedTestResult: { [key: string]: any } = {}
    const mergedPageResult: { [key: string]: { page: number } | null } = {}

    for (const key of HealthCheckupSchema.shape.test_result.keyof().options) {
        const valueTotal =
            resultDictTotal.hasOwnProperty(key) &&
            resultDictTotal[key] !== null &&
            resultDictTotal[key]!.value !== null
                ? resultDictTotal[key]
                : null;
        const pageTotal = valueTotal !== null ? resultTotalPages[key] : null;

        const valueText =
            resultDictText.hasOwnProperty(key) &&
            resultDictText[key] !== null &&
            resultDictText[key]!.value !== null
                ? resultDictText[key]
                : null;
        const pageText = valueText !== null ? resultTextPages[key] : null;

        const valueImage =
            resultDictImage.hasOwnProperty(key) &&
            resultDictImage[key] !== null &&
            resultDictImage[key]!.value !== null
                ? resultDictImage[key]
                : null;
        const pageImage = valueImage !== null ? resultImagePages[key] : null;

        if (valueTotal === null) {
            if (valueText !== null) {
                mergedTestResult[key] = valueText;
                mergedPageResult[key] = pageText;
            } else if (valueImage !== null) {
                mergedTestResult[key] = valueImage;
                mergedPageResult[key] = pageImage;
            } else {
                mergedTestResult[key] = valueText;
                mergedPageResult[key] = pageText;
            }
        } else {
            mergedTestResult[key] = valueTotal;
            mergedPageResult[key] = pageTotal;
        }
    }

    // remove all null values in mergedTestResult
    for (const key in mergedTestResult) {
        if (mergedTestResult[key] === null) {
            delete mergedTestResult[key]
        }
    }

    const healthCheckup = HealthCheckupSchema.parse({
        ...resultTotal,
        test_result: mergedTestResult
    })

    return {data: [healthCheckup], pages: [mergedPageResult], ocrResults: [ocrResults]}
}
