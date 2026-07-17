import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` makes the built asset URLs relative, so the same bundle works
// whether it is served at `/hello-react/` (production) or under a preview path.
export default defineConfig({
  plugins: [react()],
  base: './',
});
