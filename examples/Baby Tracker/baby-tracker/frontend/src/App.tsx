import { useState } from 'react'

function App() {
  const [activeTab, setActiveTab] = useState('home')

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900 pb-16">
      {/* Header */}
      <header className="bg-white shadow-sm px-4 py-4 sticky top-0 z-10 flex justify-between items-center">
        <h1 className="text-xl font-bold text-indigo-600">Baby Tracker</h1>
        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold">
          JD
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 max-w-lg mx-auto w-full">
        {activeTab === 'home' && (
          <div className="space-y-6">
            <section>
              <h2 className="text-lg font-semibold mb-3">Quick Log</h2>
              <div className="grid grid-cols-2 gap-3">
                <button className="bg-blue-100 hover:bg-blue-200 text-blue-800 p-4 rounded-xl flex flex-col items-center justify-center transition-colors">
                  <span className="text-2xl mb-1">🍼</span>
                  <span className="font-medium">Feeding</span>
                </button>
                <button className="bg-purple-100 hover:bg-purple-200 text-purple-800 p-4 rounded-xl flex flex-col items-center justify-center transition-colors">
                  <span className="text-2xl mb-1">😴</span>
                  <span className="font-medium">Sleep</span>
                </button>
                <button className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800 p-4 rounded-xl flex flex-col items-center justify-center transition-colors">
                  <span className="text-2xl mb-1">💩</span>
                  <span className="font-medium">Diaper</span>
                </button>
                <button className="bg-green-100 hover:bg-green-200 text-green-800 p-4 rounded-xl flex flex-col items-center justify-center transition-colors">
                  <span className="text-2xl mb-1">📏</span>
                  <span className="font-medium">Growth</span>
                </button>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 border-b border-gray-50 flex items-start gap-4">
                  <div className="bg-blue-50 w-10 h-10 rounded-full flex items-center justify-center text-xl">
                    🍼
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Bottle Feeding</p>
                    <p className="text-sm text-gray-500">Formula • 4 oz</p>
                  </div>
                  <span className="text-sm text-gray-400">10 mins ago</span>
                </div>
                <div className="p-4 border-b border-gray-50 flex items-start gap-4">
                  <div className="bg-yellow-50 w-10 h-10 rounded-full flex items-center justify-center text-xl">
                    💩
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Diaper Change</p>
                    <p className="text-sm text-gray-500">Wet & Dirty</p>
                  </div>
                  <span className="text-sm text-gray-400">2 hrs ago</span>
                </div>
                <div className="p-4 flex items-start gap-4">
                  <div className="bg-purple-50 w-10 h-10 rounded-full flex items-center justify-center text-xl">
                    😴
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Nap</p>
                    <p className="text-sm text-gray-500">1 hr 15 mins</p>
                  </div>
                  <span className="text-sm text-gray-400">4 hrs ago</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="flex items-center justify-center h-full text-gray-500">
            History view coming soon
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="flex items-center justify-center h-full text-gray-500">
            Settings coming soon
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white border-t border-gray-200 fixed bottom-0 w-full z-10 pb-safe">
        <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
          <button 
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center w-full h-full ${activeTab === 'home' ? 'text-indigo-600' : 'text-gray-500'}`}
          >
            <span className="text-xl mb-1">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex flex-col items-center justify-center w-full h-full ${activeTab === 'history' ? 'text-indigo-600' : 'text-gray-500'}`}
          >
            <span className="text-xl mb-1">📅</span>
            <span className="text-xs font-medium">History</span>
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center justify-center w-full h-full ${activeTab === 'settings' ? 'text-indigo-600' : 'text-gray-500'}`}
          >
            <span className="text-xl mb-1">⚙️</span>
            <span className="text-xs font-medium">Settings</span>
          </button>
        </div>
      </nav>
    </div>
  )
}

export default App
