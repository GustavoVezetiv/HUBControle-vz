import * as React from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'vezetiv-signature': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        theme?: string;
        size?: string;
      };
    }
  }
}
