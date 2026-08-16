export class AudioSelectionGeneration {
    private generation = 0;

    capture() {
        return this.generation;
    }

    invalidate() {
        ++this.generation;
    }

    isCurrent(generation: number) {
        return generation === this.generation;
    }

    async commit<T>(generation: number, write: () => Promise<T>, rollback: (value: T) => Promise<void>) {
        if (!this.isCurrent(generation)) return undefined;
        const value = await write();
        if (this.isCurrent(generation)) return value;
        await rollback(value);
        return undefined;
    }
}
