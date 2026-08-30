import React from "react";

interface Props {
  fallback: React.ReactNode;
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
}

/**
 * Skia is a brand-new native dependency here — this is the first thing standing
 * between "the shader fails on some device/GPU driver we haven't tested" and
 * "the whole app crashes." React error boundaries must be class components
 * (no hook equivalent exists), and only catch render-phase JS errors — a truly
 * deep native-side crash below the JS bridge wouldn't be catchable from here
 * either, but this covers the realistic failure mode: Skia's Canvas throwing
 * during render on an unsupported device.
 */
export class SkiaErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("Glass orb render failed, falling back:", error);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
