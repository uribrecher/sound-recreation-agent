export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export class ConversationHistory {
  private messages: Message[] = [];

  constructor(private maxMessages: number) {}

  addUser(content: string): void {
    this.messages.push({ role: "user", content });
    this.trim();
  }

  addAssistant(content: string): void {
    this.messages.push({ role: "assistant", content });
    this.trim();
  }

  getMessages(): Message[] {
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
