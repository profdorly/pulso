import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence for a render that escaped the page-level empty states.
 * Analytics and data loading already fail closed; this covers an unexpected throw.
 */
export class ReaderErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Pulso render failed", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <p className="text-base text-muted" role="alert">
          Não foi possível mostrar esta página. Recarregue ou volte à capa.
        </p>
      );
    }
    return this.props.children;
  }
}
