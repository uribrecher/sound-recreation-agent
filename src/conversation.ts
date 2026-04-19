import type { ModelMessage } from "ai";

export class ConversationHistory {
  private messages: ModelMessage[] = [];

  constructor(private maxMessages: number) {}

  addUser(content: string): void {
    this.messages.push({ role: "user", content });
    this.trim();
  }

  addResponseMessages(messages: ModelMessage[]): void {
    this.messages.push(...messages);
    this.trim();
  }

  getMessages(): ModelMessage[] {
    return [...this.messages];
  }

  reset(): void {
    this.messages = [];
  }

  private trim(): void {
    while (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
  }
}
