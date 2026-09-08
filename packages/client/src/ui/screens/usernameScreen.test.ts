// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderUsernameScreen } from './usernameScreen.js';

describe('renderUsernameScreen', () => {
  it('submits the trimmed input value', () => {
    const onSubmit = vi.fn();
    const el = renderUsernameScreen({ onSubmit });
    document.body.appendChild(el);

    const input = el.querySelector<HTMLInputElement>('[data-testid="username-input"]')!;
    input.value = '  alice  ';
    el.dispatchEvent(new Event('submit'));

    expect(onSubmit).toHaveBeenCalledWith('alice');
    document.body.removeChild(el);
  });

  it('does not submit an empty/whitespace-only username', () => {
    const onSubmit = vi.fn();
    const el = renderUsernameScreen({ onSubmit });
    const input = el.querySelector<HTMLInputElement>('[data-testid="username-input"]')!;
    input.value = '   ';
    el.dispatchEvent(new Event('submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prefills the input and surfaces an error when given', () => {
    const el = renderUsernameScreen({ onSubmit: vi.fn(), initialValue: 'bob', error: 'taken' });
    expect(el.querySelector<HTMLInputElement>('[data-testid="username-input"]')?.value).toBe('bob');
    expect(el.querySelector('[data-testid="username-error"]')?.textContent).toBe('taken');
  });
});
