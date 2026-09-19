import './ConstructionPage.css'

/**
 * Portada "Plataforma en construcción". Reemplaza al `index.html` estático
 * que publicaba GitHub Pages (INFRA-001): mismo aspecto, ahora como página
 * de la app React. Es la única ruta hasta que F5 traiga el login real.
 */
export function ConstructionPage() {
  return (
    <main className="construction-page">
      <div className="construction-page__content">
        <img
          className="construction-page__logo"
          src="/logo.png"
          width={800}
          height={670}
          alt="Extendiendo Servicios"
        />
        <p className="construction-page__status">
          <span className="construction-page__dot" aria-hidden="true" />
          Plataforma en construcción
        </p>
        <p className="construction-page__note">
          El acceso a la plataforma estará disponible próximamente.
        </p>
      </div>
    </main>
  )
}
