/**
 * Lightweight event bus (spec §78–79). Decouples systems from
 * economy / effects / audio / UI.
 */
export type GameEventName =
  | 'enemy:killed'
  | 'enemy:reached-base'
  | 'tower:built'
  | 'tower:upgraded'
  | 'tower:sold'
  | 'tower:fired'
  | 'wave:started'
  | 'wave:completed'
  | 'base:damaged'
  | 'game:over'
  | 'victory'
  | 'gold:changed';

export type EventHandler = (payload?: unknown) => void;

export class EventBus {
  private handlers = new Map<GameEventName, Set<EventHandler>>();

  on(event: GameEventName, handler: EventHandler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: GameEventName, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: GameEventName, payload?: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Copy so handlers can unsubscribe mid-emit safely.
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[events] handler for "${event}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
