import { AsyncLocalStorage } from "node:async_hooks"

export class RuntimeProducerTracker {
  private readonly context = new AsyncLocalStorage<symbol>()
  private readonly producerToken = Symbol("runtime-producer")
  private readonly pending = new Set<Promise<void>>()
  private accepting = true

  close(): void {
    this.accepting = false
  }

  run<T>(producer: () => T | Promise<T>): Promise<T> {
    if (!this.accepting) {
      return Promise.reject(new Error("Runtime producers are shutting down"))
    }
    const operation = this.context.run(this.producerToken, async () => producer())
    return this.observe(operation)
  }

  track<T>(operation: Promise<T>): Promise<T> {
    const nestedProducer = this.context.getStore() === this.producerToken
    if (!this.accepting && !nestedProducer) {
      return Promise.reject(new Error("Runtime producers are shutting down"))
    }
    return this.observe(operation)
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(Array.from(this.pending))
    }
  }

  private observe<T>(operation: Promise<T>): Promise<T> {
    const observed = operation.then(
      () => undefined,
      () => undefined
    )
    this.pending.add(observed)
    void observed.then(() => { this.pending.delete(observed) })
    return operation
  }
}
