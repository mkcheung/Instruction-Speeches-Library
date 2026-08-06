import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from '@/routes/Home'
import NotFound from '@/routes/NotFound'
import Spikes from '@/routes/Spikes'
import { isSpikesEnabled } from '@/lib/spikes-guard'

/**
 * The `/__spikes` route is only REGISTERED when the guard passes — the
 * first half of the double guard. `Spikes` itself re-checks the guard at
 * render time as the second half, so a force-navigate can't see it even if
 * this registration were ever bypassed.
 */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {isSpikesEnabled() && <Route path="/__spikes" element={<Spikes />} />}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
