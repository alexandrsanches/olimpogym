"use client";

import { useState } from "react";

/** Campo de senha com botão de mostrar/ocultar. */
export function CampoSenha() {
  const [visivel, setVisivel] = useState(false);
  return (
    <div className="campo-senha">
      <input name="senha" type={visivel ? "text" : "password"} placeholder="Senha" aria-label="Senha" autoComplete="current-password" required />
      <button type="button" onClick={() => setVisivel((v) => !v)} aria-label={visivel ? "Ocultar senha" : "Mostrar senha"} title={visivel ? "Ocultar senha" : "Mostrar senha"}>
        {visivel ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M2 5.27 3.28 4 20 20.72 18.73 22l-3.08-3.08A11.3 11.3 0 0 1 12 19.5C7 19.5 2.73 16.39 1 12a11.8 11.8 0 0 1 4.11-5.33zM12 9a3 3 0 0 1 3 3c0 .35-.06.69-.17 1L11 9.17c.31-.11.65-.17 1-.17m0-4.5c5 0 9.27 3.11 11 7.5a11.8 11.8 0 0 1-4.06 5.27l-1.42-1.43A9.2 9.2 0 0 0 20.82 12 9.82 9.82 0 0 0 12 6.5c-1.09 0-2.16.18-3.16.5L7.3 5.47c1.44-.62 3.03-.97 4.7-.97M3.18 12A9.82 9.82 0 0 0 12 17.5c.69 0 1.37-.07 2-.21L11.72 15A3 3 0 0 1 9 12.28L5.6 8.87c-.99.85-1.82 1.91-2.42 3.13"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6m0-4.5c5 0 9.27 3.11 11 7.5-1.73 4.39-6 7.5-11 7.5S2.73 16.39 1 12c1.73-4.39 6-7.5 11-7.5M3.18 12a9.82 9.82 0 0 0 17.64 0 9.82 9.82 0 0 0-17.64 0"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
