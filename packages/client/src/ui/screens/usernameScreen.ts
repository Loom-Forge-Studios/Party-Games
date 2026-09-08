import { el } from '../dom.js';

export interface UsernameScreenProps {
  initialValue?: string;
  error?: string | null;
  onSubmit: (username: string) => void;
}

const MAX_USERNAME_LENGTH = 24;

/** First screen: choose a username before connecting (protocol's `hello` requires one — see @party/protocol ClientMessage). */
export function renderUsernameScreen(props: UsernameScreenProps): HTMLElement {
  const errorId = 'pg-username-error';

  const input = el('input', {
    id: 'pg-username-input',
    name: 'username',
    type: 'text',
    autocomplete: 'nickname',
    maxlength: MAX_USERNAME_LENGTH,
    required: true,
    value: props.initialValue ?? '',
    'aria-describedby': props.error ? errorId : undefined,
    'data-testid': 'username-input',
  });

  const form = el(
    'form',
    {
      class: 'pg-screen pg-username-screen',
      'data-testid': 'username-screen',
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        const value = input.value.trim();
        if (value.length === 0) return;
        props.onSubmit(value);
      },
    },
    [
      el('h1', {}, ['Party Games']),
      el(
        'div',
        { class: 'pg-panel' },
        [
          el('label', { for: 'pg-username-input' }, ['Choose a username']),
          input,
          props.error
            ? el('p', { id: errorId, class: 'pg-error', role: 'alert', 'data-testid': 'username-error' }, [
                props.error,
              ])
            : null,
          el('button', { type: 'submit', class: 'pg-button pg-button--primary', 'data-testid': 'username-submit' }, [
            'Continue',
          ]),
        ],
      ),
    ],
  );

  return form;
}
