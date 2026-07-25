export class ConversationSyncGeneration {
  private activeConversation = 0;
  private conversationIndex = 0;

  active(): number {
    return this.activeConversation;
  }

  index(): number {
    return this.conversationIndex;
  }

  advanceActive(): number {
    this.activeConversation += 1;
    return this.activeConversation;
  }

  advanceIndex(): number {
    this.conversationIndex += 1;
    return this.conversationIndex;
  }

  isActiveCurrent(generation: number): boolean {
    return generation === this.activeConversation;
  }

  isIndexCurrent(generation: number): boolean {
    return generation === this.conversationIndex;
  }

  invalidateAll(): void {
    this.activeConversation += 1;
    this.conversationIndex += 1;
  }
}
