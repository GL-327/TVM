Placeholder only. CI and Mac builds run node apps/ios/bundle-ui.mjs, which
replaces this folder with the production Vite build of apps/ui.
The iOS app then serves those files from a loopback HTTP server. This is not
a Home Screen web clip and does not require a PC.
