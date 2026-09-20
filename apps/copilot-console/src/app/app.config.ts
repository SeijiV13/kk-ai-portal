import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { authHttpInterceptorFn, provideAuth0 } from '@auth0/auth0-angular';
import { provideCopilotKit } from '@copilotkit/angular';

import { auth0Config } from './auth0.config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter([]),
    provideHttpClient(withInterceptors([authHttpInterceptorFn])),
    provideAuth0({
      domain: auth0Config.domain,
      clientId: auth0Config.clientId,
      authorizationParams: {
        redirect_uri: window.location.origin,
        audience: auth0Config.audience,
        scope: auth0Config.scope,
        screen_hint: 'login',
        connection: auth0Config.connection,
      },
      httpInterceptor: {
        allowedList: [
          {
            uri: 'http://localhost:8200/api/mastra/*',
            tokenOptions: {
              authorizationParams: {
                audience: auth0Config.audience,
                scope: auth0Config.scope,
              },
            },
          },
        ],
      },
    }),
    provideCopilotKit({
      runtimeUrl: 'http://localhost:8200/api/copilotkit',
    }),
  ],
};