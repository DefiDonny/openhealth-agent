import {BaseVisionParser, VisionParseOptions, VisionParserModel} from "@/lib/health-data/parser/vision/base-vision";
import {ChatAnthropic} from "@langchain/anthropic";
import {HealthCheckupSchema} from "@/lib/health-data/parser/schema";
import {ChatPromptTemplate} from "@langchain/core/prompts";
import {currentDeploymentEnv} from "@/lib/current-deployment-env";

export class AnthropicVisionParser extends BaseVisionParser {

    get name(): string {
        return "Anthropic";
    }

    get apiKeyRequired(): boolean {
        return currentDeploymentEnv === 'local'
    }

    get enabled(): boolean {
        return true
    }

    async models(): Promise<VisionParserModel[]> {
        return [
            {id: 'claude-sonnet-4-20250514', name: 'claude-sonnet-4-20250514'},
        ];
    }

    async parse(options: VisionParseOptions) {
        const llm = new ChatAnthropic({
            model: options.model.id,
            apiKey: currentDeploymentEnv === 'cloud' ? process.env.ANTHROPIC_API_KEY : options.apiKey,
            maxTokens: 4096,
            topP: undefined,
        })
        const messages = options.messages || ChatPromptTemplate.fromMessages([]);
        const chain = messages.pipe(llm.withStructuredOutput(HealthCheckupSchema, {
            method: 'functionCalling',
        }).withConfig({
            runName: 'health-data-parser',
            metadata: {input: options.input}
        }))
        return await chain.withRetry({stopAfterAttempt: 3}).invoke(options.input);
    }
}
