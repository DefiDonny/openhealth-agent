import {OpenAIVisionParser} from "@/lib/health-data/parser/vision/openai";
import {GoogleVisionParser} from "@/lib/health-data/parser/vision/google";
import {AnthropicVisionParser} from "@/lib/health-data/parser/vision/anthropic";
import {OllamaVisionParser} from "@/lib/health-data/parser/vision/ollama";

const visions = [
    new OpenAIVisionParser(),
    new GoogleVisionParser(),
    new AnthropicVisionParser(),
    new OllamaVisionParser(),
].filter(v => v.enabled)

export default visions
