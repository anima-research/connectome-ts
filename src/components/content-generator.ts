import { Component } from '../spaces/component';
import { LLMProvider, LLMMessage } from '../llm/llm-interface';

/**
 * Component that generates unique box contents using LLM
 */
export class ContentGeneratorComponent extends Component {
  private previousContents: string[] = [];
  private llmProvider: LLMProvider;
  
  constructor(llmProvider: LLMProvider) {
    super();
    this.llmProvider = llmProvider;
  }
  
  /**
   * Generate unique contents for a new box
   */
  async generateContents(size: string, color: string): Promise<string> {
    // For mock provider, generate deterministic content
    if (this.llmProvider.getProviderName() === 'mock') {
      return this.generateMockContents(size, color);
    }
    
    // Build prompt with previous contents
    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: `You are a magical box content generator. Generate a unique, creative, and whimsical item or creature that could be inside a ${size} ${color} box.

Previous box contents (DO NOT repeat these):
${this.previousContents.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Requirements:
- Be creative and imaginative
- Keep it brief (1-2 lines)
- Make it appropriate for the box's size and color
- Do not repeat any previous contents
- Include sensory details (how it looks, sounds, or feels)

Respond with ONLY the contents description, no additional text.`
      }
    ];
    
    try {
      const response = await this.llmProvider.generate(messages, {
        maxTokens: 50,
        temperature: 1.2 // Higher temperature for more creativity
      });
      
      const contents = response.content.trim();
      this.previousContents.push(contents);
      
      // Keep only last 10 contents in memory
      if (this.previousContents.length > 10) {
        this.previousContents.shift();
      }
      
      return contents;
    } catch (error) {
      console.error('Failed to generate contents:', error);
      return this.generateMockContents(size, color);
    }
  }
  
  /**
   * Generate mock contents for testing
   */
  private generateMockContents(size: string, color: string): string {
    const sizeItems = {
      small: ['tiny dragon', 'miniature star', 'pocket universe', 'whisper crystal'],
      medium: ['glowing orb', 'singing flower', 'memory cube', 'dream catcher'],
      large: ['portal mirror', 'weather machine', 'time capsule', 'gravity sphere']
    };
    
    const colorModifiers = {
      red: 'fiery',
      blue: 'oceanic',
      green: 'verdant',
      rainbow: 'prismatic'
    };
    
    const items = sizeItems[size as keyof typeof sizeItems] || sizeItems.medium;
    const modifier = colorModifiers[color as keyof typeof colorModifiers] || 'mysterious';
    
    // Pick a random item that hasn't been used recently
    const availableItems = items.filter(item => 
      !this.previousContents.some(prev => prev.includes(item))
    );
    
    const item = availableItems.length > 0 
      ? availableItems[Math.floor(Math.random() * availableItems.length)]
      : items[Math.floor(Math.random() * items.length)];
    
    const contents = `a ${modifier} ${item} that ${this.getRandomEffect()}`;
    this.previousContents.push(contents);
    
    if (this.previousContents.length > 10) {
      this.previousContents.shift();
    }
    
    return contents;
  }
  
  private getRandomEffect(): string {
    const effects = [
      'hums with ancient power',
      'sparkles in the light',
      'whispers forgotten secrets',
      'pulses with gentle warmth',
      'shifts between dimensions',
      'glows with inner light',
      'sings a haunting melody',
      'radiates peaceful energy'
    ];
    
    return effects[Math.floor(Math.random() * effects.length)];
  }
}
