/* Tanga ichidagi anime qiz rasmi o'rniga vaqtinchalik chiroyli tekstura */
        .main-coin::after {
            content: "YUMI COIN CLASSIC GOLD";
            color: #fff;
            font-size: 12px;
            font-weight: bold;
            text-align: center;
            width: 80%;
            opacity: 0.8;
            border: 2px dashed rgba(255,255,255,0.4);
            padding: 20px;
            border-radius: 50%;
        }

        .main-coin:active {
            transform: scale(0.95);
        }

        /* "+2" effekti uchun uslub */
        .floating-text {
            position: absolute;
            color: #ffffff;
            font-size: 28px;
            font-weight: bold;
            pointer-events: none;
            animation: floatUp 0.6s ease-out forwards;
            text-shadow: 0 2px 4px rgba(0,0,0,0.5);
        }

        @keyframes floatUp {
            0% { opacity: 1; transform: translateY(0) scale(1); }
            100% { opacity: 0; transform: translateY(-100px) scale(1.2); }
        }

        /* O'yin va Do'kon tugmalari */
        .sub-buttons {
            display: flex;
            gap: 12px;
            margin-bottom: 30px;
        }

        .sub-btn {
            background: #282417;
            border: 1px solid #3d3723;
            color: #cca043;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
        }

        /* Energiya qismi */
        .energy-section {
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding: 0 10px;
        }

        .energy-title {
            font-size: 14px;
            color: #8a8471;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .energy-title i { color: #f4b400; }

        .energy-value {
            font-size: 18px;
            font-weight: bold;
        }
        .energy-value span { color: #8a8471; font-size: 14px; }

        /* Energiya sotib olish tugmasi */
        .buy-energy-btn {
            width: 100%;
            background: #cca043;
            color: #000000;
            border: none;
            padding: 14px;
            border-radius: 14px;
            font-size: 15px;
            font-weight: bold;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            cursor: pointer;
        }

        /* Pastki Navigatsiya paneli */
        .bottom-nav {
            position: fixed;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            width: calc(100% - 32px);
            max-width: 450px;
            background: #1c1910;
            border-top: 1px solid #282417;
            display: flex;
            justify-content: space-around;
            padding: 10px 0;
            border-radius: 0 0 24px 24px;
        }

        .nav-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            color: #8a8471;
            font-size: 11px;
            cursor: pointer;
            width: 20%;
            text-align: center;
        }

        .nav-item i { font-size: 18px; }
        .nav-item.active { color: #cca043; }
    </style>
</head>
<body>

<div class="app-container">
    
    <!-- Yuqori qism -->
    <div class="top-bar">
        <div class="user-info">
            <div class="avatar"><i class="fa-solid fa-user-astronaut" style="color: white;"></i></div>
            <div>
                <div class="username">YUMI COIN</div>
