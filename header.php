
<!DOCTYPE html>
<html lang="en">
		<head>
			<link href = "../css/bootstrap.css" type="text/css" rel="stylesheet">
			<link href = "../css/bootstrap-responsive.min.css" type="text/css" rel="stylesheet">
			<link href = "../css/customized.css" type="text/css" rel="stylesheet">
			<link href = "../css/bootstrap-timepicker.min.css" type="text/css" rel="stylesheet">


			<link href = "styles.css" type="text/css" rel="stylesheet">
			<link rel="stylesheet" href="http://code.jquery.com/ui/1.10.0/themes/base/jquery-ui.css">
			<script src="http://code.jquery.com/ui/1.10.0/jquery-ui.js"></script>

			<script type="text/javascript" src="../js/jquery-1.9.0.js"></script>
			<script type="text/javascript" src="../js/jquery.form.js"></script>
			<script type="text/javascript" src="../js/jquery-ui-1.10.0.custom.js"></script>
			<script type="text/javascript" src="../js/bootstrap.js"></script>
			<script type="text/javascript" src="submit.js"></script>
			<script type="text/javascript" src="../js/popcorn-complete.min.js"></script>
			<script type="text/javascript" src="../js/bootstrap-timepicker.min.js"></script>
		</head>

		<div class="wrapper">	
		<body>

			<div id="registerErrorMessages"></div>
			<div id="sampleHeaderBar">
				<div style="display:inline">Need help with your communication skills?</div>
		  		<?php
		  			if($SESS->loggedIn == false){
		  		?>
		  		<button id="loginOrRegister"  class="btn btn-mini btn-inverse" type="button">Register</button>
				<?php
					}
				?>
			</div>

