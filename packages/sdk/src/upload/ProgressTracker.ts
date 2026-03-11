export class ProgressTracker {
  private completed = 0;

  constructor(
    private readonly total: number,
    private readonly onChange: (progress: number) => void,
  ) {}

  tick(): void {
    this.completed++;
    this.onChange(Math.round((this.completed / this.total) * 100));
  }
}
