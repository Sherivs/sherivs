# Frontend

The Sherivs Scholar web platform (TanStack Start full-stack application).

```
frontend/
  public/          static assets (service worker, robots.txt)
  src/
    components/    UI components and design system
    routes/        file-based routes (pages + BFF API routes)
    hooks/         shared React hooks
    contexts/      app context (school, auth, theme)
    lib/           services, business logic, server functions
    integrations/  Supabase clients and auth middleware
    types/         shared TypeScript types
```

Build configuration (Vite, Tailwind, TanStack Start) lives at the repository
root. The `@/` import alias resolves to `frontend/src/`.

