console.log('📱 INDEX.TSX: Starting app entry point');
import { registerRootComponent } from 'expo';
import App from '../src/App';

console.log('📱 INDEX.TSX: About to register root component');
registerRootComponent(App);
console.log('📱 INDEX.TSX: Root component registered');
