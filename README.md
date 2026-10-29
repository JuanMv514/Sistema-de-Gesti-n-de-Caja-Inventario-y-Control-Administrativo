#Sistema Administrativo - Vidrios y Aluminios El Carmen

Aplicación web administrativa (Single Page Application - SPA) diseñada a medida para la gestión y control interno del negocio Vidrios y Aluminios El Carmen. El sistema permite centralizar las operaciones de ventas, control de inventario y contabilidad básica desde una interfaz rápida, segura y accesible en la nube.

🚀 Arquitectura y Tecnologías

El proyecto está construido bajo una arquitectura Serverless y SPA puro, eliminando la necesidad de un backend tradicional. Toda la lógica de enrutamiento, protección de vistas y conexión a bases de datos se gestiona directamente en el cliente.

Frontend: HTML5, CSS3 (Tailwind CSS) y Vanilla JavaScript.

Backend as a Service (BaaS): Firebase (Authentication & Cloud Firestore).

Hosting: Netlify.

📦 Módulos Principales

1. Caja y Ventas

Interfaz de Punto de Venta (POS) para el registro rápido de productos.

Gestión de métodos de pago y cálculo automático de totales.

Control de apertura y cierre de caja.

2. Inventario

Catálogo de productos en tiempo real.

Control de existencias, precios y alertas de stock bajo.

Registro de movimientos operativos (entradas y salidas).

3. Contabilidad Básica

Registro y categorización de ingresos y gastos operativos.

Historial de movimientos administrativos.

Nota: Este módulo es de control interno y no reemplaza un software contable fiscal.

4. Consultas y Reportes

Dashboard interactivo con métricas clave del negocio.

Resúmenes en tiempo real cruzando datos de ventas, gastos e inventario.

5. Usuarios y Seguridad

Autenticación segura respaldada por Firebase Auth.

Control de acceso basado en roles (Administrador, Empleado).

Guardianes de ruta (Route Guards) mediante JavaScript para proteger las vistas internas.

🛠️ Estructura del SPA

El sistema se carga en un único archivo index.html. La navegación inyecta las plantillas de forma dinámica en un contenedor principal (#app-root) interceptando los eventos del historial del navegador.

Sin recargas: Transiciones fluidas entre módulos.

Reactividad: Uso de onSnapshot de Firestore para actualizar el inventario y los reportes en las pantallas de todos los usuarios conectados sin necesidad de refrescar la página.

⚙️ Instalación y Configuración Local

Clona este repositorio:

git clone https://github.com/tu-usuario/vidrios-el-carmen-app.git


Configura las variables de entorno:
Crea un archivo de configuración para inicializar Firebase con las credenciales del proyecto (ApiKey, AuthDomain, ProjectId, etc.).

Despliegue local:
Al ser HTML/JS puro, puedes utilizar extensiones como Live Server en VSCode o cualquier servidor HTTP estático para levantar el proyecto localmente.

Desarrollado para la optimización de los procesos internos de Vidrios y Aluminios El Carmen.
