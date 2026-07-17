# hello-react

A minimal Vite + React app used to demo `snow-deploy`.

```bash
npm install

# deploy it (mock mode needs no Snowflake account)
export SNOWD_MOCK=1
node ../../cli/bin/snowd.js init
node ../../cli/bin/snowd.js deploy --prod
```

`vite.config.js` sets `base: './'` so the built bundle uses relative asset URLs
and works whether it's served at `/hello-react/` (production) or under a
`/hello-react/~/<deploymentId>/` preview path.
