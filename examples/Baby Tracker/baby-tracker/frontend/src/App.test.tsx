import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { vi } from 'vitest';

// Mock the API module
vi.mock('./lib/api', () => {
  return {
    default: {
      get: vi.fn().mockResolvedValue({ data: { babies: [] } }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      }
    }
  };
});

describe('App Routing & Smoke Test', () => {
  beforeEach(() => {
    // Clear local storage to ensure unauthenticated state
    window.localStorage.clear();
    window.history.pushState({}, '', '/login');
  });

  it('redirects to login when unauthenticated', () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );
    
    // Should show the login screen
    expect(screen.getByText('Sign in to Baby Tracker')).toBeInTheDocument();
  });

  it('can navigate to register screen', () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );
    
    const signUpLink = screen.getByText('Sign up');
    fireEvent.click(signUpLink);
    
    // Should show the register screen
    expect(screen.getByText('Create an account')).toBeInTheDocument();
  });

  it('can navigate to forgot password screen from login', () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    const forgotPasswordLink = screen.getByText('Forgot your password?');
    fireEvent.click(forgotPasswordLink);

    expect(screen.getByText('Reset Password')).toBeInTheDocument();
  });
});
