import Anthropic from '@anthropic-ai/sdk';

/**
 * AI provider abstraction. The assistant's tool loop speaks Anthropic's Messages
 * format; a different provider would adapt that format here, in one place.
 */
export interface AIProvider {
  readonly key: string;
  readonly model: string;
  createMessage(params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model'>): Promise<Anthropic.Beta.BetaMessage>;
}

export class AnthropicAIProvider implements AIProvider {
  readonly key = 'anthropic';
  private client: Anthropic;
  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }
  createMessage(params: Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model'>) {
    return this.client.beta.messages.create({ ...params, model: this.model });
  }
}

export { Anthropic };
