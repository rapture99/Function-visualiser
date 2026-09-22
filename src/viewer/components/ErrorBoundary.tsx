import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Keeps a failure in one view from blanking the whole application.
 *
 * Without one, any error thrown while rendering — or inside an effect — makes React unmount
 * the entire tree, and the user sees an empty page with no clue why. That is exactly what
 * happened when the 3D view could not start its layout worker inside a VS Code webview. With
 * one, the failing view is replaced by its message and a way out, and everything else keeps
 * working.
 */

interface Props {
  children: ReactNode
  /** Change this to clear a caught error — e.g. when the document or view mode changes. */
  resetKey?: string
  fallback: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[flow-visualizer] view failed:', error, info.componentStack)
  }

  override componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  override render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null }))
    }
    return this.props.children
  }
}
