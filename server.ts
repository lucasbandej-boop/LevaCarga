import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

interface Driver {
    id: string;
    name: string;
    bi: string;
    phone: string;
    email: string;
    vehicleType: string;
    licensePlate: string;
    lat?: number;
    lng?: number;
}

const drivers: Map<string, Driver> = new Map();

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

app.post('/api/drivers/register', (req, res) => {
    const { name, bi, phone, email, vehicleType, licensePlate } = req.body;

    if (!name || !bi || !phone || !email || !vehicleType || !licensePlate) {
        return res.status(400).json({ success: false, message: 'Todos os campos são obrigatórios.' });
    }

    const driverId = 'drv_' + Date.now();
    const newDriver: Driver = { id: driverId, name, bi, phone, email, vehicleType, licensePlate };
    
    drivers.set(driverId, newDriver);

    console.log('[LOGISTICA] Novo motorista cadastrado: ' + name);

    return res.status(201).json({
        success: true,
        message: 'Cadastramento concluído com sucesso! Seja bem-vindo à rede de logística corporativa Uber Carga.',
        driverId
    });
});

io.on('connection', (socket: Socket) => {
    console.log('[DISPOSITIVO CONECTADO] ID: ' + socket.id);

    socket.on('update_location', (data: { driverId: string, lat: number, lng: number }) => {
        if (drivers.has(data.driverId)) {
            const driver = drivers.get(data.driverId)!;
            driver.lat = data.lat;
            driver.lng = data.lng;
            drivers.set(data.driverId, driver);
            socket.join('driver_' + data.driverId);
        }
    });

    socket.on('request_freight', (data: { clientName: string, lat: number, lng: number, cargoDetails: string }) => {
        console.log('[FRETE] Processando busca de proximidade...');
        
        let closestDriver: Driver | null = null;
        let minDistance = Infinity;

        drivers.forEach((driver) => {
            if (driver.lat && driver.lng) {
                const distance = calculateDistance(data.lat, data.lng, driver.lat, driver.lng);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestDriver = driver;
                }
            }
        });

        if (closestDriver) {
            const selectedDriver = closestDriver as Driver;
            console.log('[GEOMATCHING] Motorista encontrado: ' + selectedDriver.name);
            
            io.to('driver_' + selectedDriver.id).emit('freight_assigned', {
                request: data,
                distance: minDistance.toFixed(2)
            });
            socket.emit('search_result', { success: true, message: 'Ordem enviada para o motorista ' + selectedDriver.name + ' à distância de ' + minDistance.toFixed(2) + 'km.' });
        } else {
            socket.emit('search_result', { success: false, message: 'Nenhum operador logístico disponível nas proximidades no momento.' });
        }
    });
});

server.listen(PORT, () => {
    console.log('====== UBER CARGA ENTERPRISE RUNNING ======');
    console.log('Servidor ativo localmente na porta: ' + PORT);
    console.log('===========================================');
});
