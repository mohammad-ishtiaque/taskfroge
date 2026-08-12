import type { Config } from '@react-router/dev/config';

export default {
  // Server-side rendering. The role decides which shell a user gets, and that
  // decision must be made on the server — rendering it client-side would
  // briefly show a shell the user is not entitled to.
  ssr: true,

  future: {
    // Route middleware. Turned on for one reason: keeping the access token
    // fresh was every route's job, and six routes forgot, so a tab left open
    // for fifteen minutes crashed instead of refreshing. Middleware on the root
    // route runs before every loader and action in the app, which makes it the
    // only place the job can be done where forgetting is not possible.
    //
    // The other half of why it has to be middleware: a rotated refresh token
    // must be written back to the cookie, and only something holding the
    // outgoing Response can set a cookie. A loader cannot — including when it
    // throws a redirect, which is most of the interesting cases.
    v8_middleware: true,
  },
} satisfies Config;
