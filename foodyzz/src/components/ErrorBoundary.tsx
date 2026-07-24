import React from 'react';
import { View, Text, Pressable } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * App-wide render error boundary. Catches errors thrown during render/lifecycle
 * of the wrapped tree (a raw exception would otherwise unmount everything and
 * leave a blank screen) and shows a recoverable fallback. "Try again" resets the
 * error state so the tree re-mounts and re-renders. Dependency-free by design.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) console.error('ErrorBoundary caught:', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#ffffff' }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 8, textAlign: 'center' }}>
            Something went wrong
          </Text>
          <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 24, textAlign: 'center' }}>
            An unexpected error occurred. You can try again.
          </Text>
          <Pressable
            onPress={this.handleReset}
            style={{ backgroundColor: '#507425', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '800', fontSize: 13 }}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
