<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("userrole.php");
include_once("function.php");



if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$userRoles = UserRole::find_all();

$errors = array();
$required_fields = array('uploadRole_role') ;

if(isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){

		$theRole = mysql_real_escape_string(htmlspecialchars($_POST['uploadRole_role']));

		$newUR = UserRole::newUserRole($theRole);

		if($newUR->save()){
			redirect_to("settings.php");
		} else {
			die("Cannot create new user role. " . mysql_error());
		}

	} else {
		foreach($errors as $error){
			echo "<p>$error</p></br>";
		}
	}
}

?>

<!-- Load existing values for examination -->
<script>
	var existingRoles = Array();
<?php 
	foreach($userRoles as $userRole){
?>
	existingRoles.push('<?=$userRole->role?>');
<?php
	}
?>
</script>

<script src='validator.js'></script>


<form id="userRoleInputForm" action="userRoleInput.php" method="post">
	<fieldset>
		<legend class="formTitle">New Role:</legend>
			<label for="uploadRole_role">Role:</label>
			<input class="text" id="uploadRole_role" type="text" name="uploadRole_role"/></br> 
			<div style="color:red; font-size:12px;" class="validation"></div>
			<input id="submit" name="submit" type="hidden"/></br>
			<input id="userRoleSubmit" name="submit" type="submit" class="btn btn-primary pull-right"/></br>
	</fieldset>
</form>


<script>

	$('#userRoleInputForm input').blur(function(){
		var id = $(this).attr('id');
		var value = $(this).val();
		switch(id){
			case 'uploadRole_role' :
				if(value.length == 0){
					$(this).siblings('div[class="validation"]').text('A role is required.');
				} else if (jQuery.inArray(value, existingRoles) >= 0) {
					$(this).siblings('div[class="validation"]').text('This role already exists.');
				} else {
					$(this).siblings('div[class="validation"]').text('');	
				}
				break;
			default: 
				break;
		}
	});

	$('#addEditRoleBlock').unbind();
	$('#addEditRoleBlock').on("click","#userRoleSubmit", function(e){
		e.preventDefault();
		e.stopPropagation();
		validatorInstance.collectRoleData(existingRoles);
	});
</script>