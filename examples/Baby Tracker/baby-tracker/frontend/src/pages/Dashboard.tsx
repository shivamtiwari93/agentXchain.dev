import { Link } from 'react-router-dom';
import { useBaby } from '../context/BabyContext';
import { differenceInMonths, differenceInDays } from 'date-fns';

export default function Dashboard() {
  const { selectedBaby, babies, isLoading } = useBaby();

  if (isLoading) {
    return <div className="p-4 flex justify-center">Loading...</div>;
  }

  if (babies.length === 0) {
    return (
      <div className="p-4 flex flex-col items-center justify-center h-full text-center space-y-6 mt-12">
        <div className="w-24 h-24 bg-indigo-100 rounded-full flex items-center justify-center text-4xl">
          👶
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Welcome to Baby Tracker</h2>
          <p className="text-gray-500 max-w-xs mx-auto">
            Get started by creating a profile for your baby to track feedings, sleep, and more.
          </p>
        </div>
        <Link
          to="/add-baby"
          className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-full shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
        >
          Add Baby Profile
        </Link>
      </div>
    );
  }

  if (!selectedBaby) {
    return <div className="p-4">Please select a baby</div>;
  }

  const dob = new Date(selectedBaby.date_of_birth);
  const now = new Date();
  const months = differenceInMonths(now, dob);
  const days = differenceInDays(now, dob) % 30;
  
  const ageString = months > 0 
    ? `${months} month${months !== 1 ? 's' : ''}`
    : `${days} day${days !== 1 ? 's' : ''}`;

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
        <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center text-3xl mx-auto mb-3">
          {selectedBaby.name.charAt(0).toUpperCase()}
        </div>
        <h2 className="text-2xl font-bold text-gray-900">{selectedBaby.name}</h2>
        <p className="text-gray-500">{ageString} old</p>
      </div>

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
            <span className="text-2xl mb-1">📝</span>
            <span className="font-medium">Note</span>
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-gray-500">
          <p>No events logged yet.</p>
          <p className="text-sm mt-1">Tap a button above to start tracking.</p>
        </div>
      </section>
    </div>
  );
}
