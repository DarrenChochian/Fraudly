export default function App() {
  return (
    <div className="app">
      <h1>TD Fraud Detection</h1>
      <p>React + Electron + Vite</p>
      {window.electronAPI && (
        <p className="muted">Running on {window.electronAPI.platform}</p>
      )}
    </div>
  )
}
