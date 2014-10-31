<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("Club.php");
require_once("function.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$clubs = Club::find_all();

if(isset($_POST['submit'])){
	$name = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_name']));
	$address = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_address']));
	$city = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_city']));
	$state = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_state']));
	$zip = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_zip']));
	$password = mysql_real_escape_string(htmlspecialchars($_POST['uploadClubsForm_password']));

	$newClub = Club::newClub($name, $address, $city, $state, $zip, $password);

	if($newClub->save()){
		redirect_to("settings.php");
	} else {
		die("Cannot create club." . mysql_error());
	}	
}

?>

<!-- Load existing values for examination -->
<script>
	var uploadClubs_existingClubs = Array();
<?php 
	foreach($clubs as $club){
?>
	uploadClubs_existingClubs.push('<?=$club->name?>');
<?php
	}
?>
</script>
<script src='validator.js'></script>
		<form id="uploadClubsForm" action="uploadClubs.php" method="post">
			<fieldset>
				<legend class="formTitle">New Club:</legend>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadClubsForm_name">Name:</label>
							<input class="text" type="text" id="uploadClubsForm_name" name="uploadClubsForm_name"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadClubsForm_address">Address:</label>
							<input class="text" type="text" id="uploadClubsForm_address" name="uploadClubsForm_address"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadClubsForm_city">City:</label>
							<input class="text" type="text" id="uploadClubsForm_city" name="uploadClubsForm_city"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadClubsForm_state">State:</label>
							<input class="text" type="text" id="uploadClubsForm_state" name="uploadClubsForm_state"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
					<div class="row-fluid">
						<div class="span6">
							<label for="uploadClubsForm_zip">Zip:</label>
							<input class="text" type="text" id="uploadClubsForm_zip" name="uploadClubsForm_zip"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
						<div class="span6">
							<label for="uploadClubsForm_password">Password:</label>
							<input class="text" type="uploadClubsForm_password" name="uploadClubsForm_password" id="uploadClubsForm_password"/>
							<div style="color:red; font-size:12px;" class="validation"></div>
						</div>
					</div>
				<input type="hidden" id="submit2" name="submit"/>
				<input id="clubSubmit" type="submit" name="submit" value="submit" class="btn btn-primary pull-right"/>
			</fieldset>
		</form>

<script>	

	$('#uploadClubsForm input').blur(function(e){
		e.preventDefault();
		e.stopPropagation();
		var id = $(this).attr('id');
		var value = $(this).val();

		switch(id){
			case 'uploadClubsForm_name' :
				if(value.length == 0){
					$('#uploadClubsForm_name').next('div[class="validation"]').text('A club name is required.');
				} else if (jQuery.inArray(value, uploadClubs_existingClubs) >= 0) {
					$('#uploadClubsForm_name').next('div[class="validation"]').text('This club name has been taken.');
				} else {
					$('#uploadClubsForm_name').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_address' :
				if(value.length == 0){
					$('#uploadClubsForm_address').next('div[class="validation"]').text('An address is required.');
				} else {
					$('#uploadClubsForm_address').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_city' :
				if(value.length == 0){
					$('#uploadClubsForm_city').next('div[class="validation"]').text('A city is required.');
				} else {
					$('#uploadClubsForm_city').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_state' :
				if(value.length == 0){
					$('#uploadClubsForm_state').next('div[class="validation"]').text('A state is required.');
				} else {
					$('#uploadClubsForm_state').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_zip' :
				if(value.length == 0){
					$('#uploadClubsForm_zip').next('div[class="validation"]').text('A zip is required.');
				} else {
					$('#uploadClubsForm_zip').next('div[class="validation"]').text('');	
				}
				break;
			case 'uploadClubsForm_password' :
				if(value.length == 0){
					$('#uploadClubsForm_password').next('div[class="validation"]').text('A password is required.');
				} else {
					$('#uploadClubsForm_password').next('div[class="validation"]').text('');	
				}
				break;
			default: 
				break;
		}
	});

	$('#addEditClubsBlock').unbind();
	$('#addEditClubsBlock').on('click','#clubSubmit', function(e){
		e.preventDefault();
		e.stopPropagation();
		validatorInstance.collectClubData(uploadClubs_existingClubs);
	});

</script>