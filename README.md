# Sistema de Gestión de Caja, Inventario y Control Administrativo

## Descripción del Proyecto
Este repositorio contiene el código fuente de una aplicación web diseñada para centralizar, automatizar y optimizar la administración diaria de un negocio. El sistema provee una solución integral que conecta directamente las operaciones de punto de venta con el control de inventario y la contabilidad interna, eliminando la necesidad de llevar registros manuales dispersos.

## Lo que se espera lograr
El objetivo principal del proyecto es entregar una herramienta de gestión eficiente y segura que permita a los administradores tener un control total sobre su negocio. Específicamente, el sistema busca:
*   **Automatizar las ventas:** Agilizar el registro de transacciones, la selección de métodos de pago y el cierre de caja diario.
*   **Sincronizar el inventario:** Descontar automáticamente las existencias al realizar una venta y facilitar el registro de nuevas entradas (compras a proveedores).
*   **Proteger la información:** Restringir el acceso a módulos sensibles financieros y administrativos mediante un sistema de autenticación basado en roles de usuario.
*   **Facilitar el análisis financiero:** Proporcionar un panel de control (Dashboard) y reportes detallados que consoliden ventas, ingresos extraordinarios y gastos.
*   **Ofrecer inteligencia de negocio:** Analizar periódicamente el flujo de datos para generar recomendaciones automáticas sobre productos de alta rotación y alertas de gastos inusuales.

## Cómo se va a lograr (Arquitectura y Metodología)
Para alcanzar estos objetivos, el proyecto se desarrollará bajo una arquitectura Full-Stack apoyada en metodologías ágiles, garantizando escalabilidad y transacciones seguras:

### 1. Arquitectura Técnica
*   **Interfaz de Usuario (Frontend):** Se construirá un cliente web responsivo e interactivo utilizando HTML5, CSS y JavaScript (manipulación del DOM). Esta capa estará diseñada para consumirse desde cualquier dispositivo con acceso a internet y se alojará en servicios de nube para sitios estáticos.
*   **Lógica de Servidor (Backend):** Toda la lógica de negocio y las validaciones de seguridad residirán en una API RESTful desarrollada en Java utilizando el framework Spring Boot. Esto protegerá las credenciales y procesará las transacciones de manera centralizada.
*   **Persistencia de Datos (Base de Datos):** Para garantizar que operaciones conjuntas (como registrar una venta y descontar stock simultáneamente) no presenten inconsistencias, se utilizará un motor de base de datos relacional (PostgreSQL o MySQL). La comunicación con la base de datos se realizará mediante mapeo objeto-relacional (ORM) usando JPA e Hibernate.

### 2. Flujo de Trabajo
*   **Metodología Ágil:** El alcance del sistema se ha dividido en módulos independientes (Caja, Inventario, Usuarios, Movimientos, Dashboard, Reportes y Análisis). El desarrollo se ejecutará iterativamente planificando Sprints y resolviendo requerimientos funcionales documentados como Historias de Usuario.
*   **Control de Versiones:** Se utilizará Git para gestionar el código fuente. Cada funcionalidad o historia de usuario se desarrollará en una rama secuencial independiente (feature branches) antes de ser integrada al código principal, asegurando un entorno de colaboración limpio y estable.
