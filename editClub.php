<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("Club.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$errors = array();
$required_fields = array('editClub_name','editClub_address','editClub_city', 'editClub_state', 'editClub_zip', 'editClub_password');



if(isset($_POST['clubid'])){
	$club_id = $_POST['clubid'];     
	$club = Club::find_by_id($club_id);
	$clubs = Club::find_all(); 
?>

<!-- Load existing values for examination -->
<script>
	var currentClub = '<?=$club->name?>';
	var editClubs_existingClubs = Array();
<?php 
	foreach($clubs as $aClub){
?>
	editClubs_existingClubs.push('<?=$aClub->name?>');
<?php
	}
?>
</script>
<script src='validator.js'></script>
	<!-- <div id="registerErrorMessages"></div> -->
	<form action="editClub.php" method="post" id="editClubForm">
		<legend class="formTitle">Edit Club Details:</legend>
		<div class="row-fluid">
			<div class="span6">
					<input type="hidden" id="id" name="id" value="<?=$club->id?>"/>
					<label for="editClub_name">Name:</label>
					<input class="text" id="editClub_name" name="editClub_name" value="<?=$club->name?>"/>
					<div style="color:red; font-size:12px;" class="validation"></div>
			</div>
			<div class="span6">
					<label for="editClub_address">Address:</label>
					<input class="text" id="editClub_address" name="editClub_address" value="<?=$club->address?>"/>
					<div style="color:red; font-size:12px;" class="validation"></div>
			</div>
		</div>
		<div class="row-fluid">
			<div class="span6">
					<label for="editClub_city">City:</label>
					<input class="text" id="editClub_city" name="editClub_city" value="<?=$club->city?>"/>
					<div style="color:red; font-size:12px;" class="validation"></div>
			</div>
			<div class="span6">
					<label for="editClub_state">State:</label>
					<input class="text" id="editClub_state" name="editClub_state" value="<?=$club->state?>"/>
					<div style="color:red; font-size:12px;" class="validation"></div>
			</div>
		</div>
		<div class="row-fluid">
			<div class="span6">
					<label for="editClub_zip">Zip:</label>
					<input class="text" id="editClub_zip" name="editClub_zip" value="<?=$club->zip?>"/>
					<div style="color:red; font-size:12px;" class="validation"></div>
			</div>
			<div class="span6">
					<label for="editClub_password">Password:</label>
					<input class="text" name="editClub_password" id="editClub_password" value="<?=$club->password?>"/>
					<div style="color:red; font-size:12px;" class="validation"></div>
			</div>
		</div></br>
		<div class="span12">
			<div class='row-fluid'>
				<div class='span6'>
					<input type="hidden" id="submit2" name="submit"/>
					<input id="editClubSubmit" type="submit" name="submit" class="btn btn-primary"/>
					<script>	

						$('#editClubForm input').blur(function(e){
							e.preventDefault();
							e.stopPropagation();
							var id = $(this).attr('id');
							var value = $(this).val();
							// console.log(id);
							// console.log(value);
							switch(id){
								case 'editClub_name' :
									if(value.length == 0){
										$('#editClub_name').next('div[class="validation"]').text('A club name is required.');
									} else if ((jQuery.inArray(value, editClubs_existingClubs) >= 0) && (currentClub != editClubs_existingClubs[(jQuery.inArray(value, editClubs_existingClubs))])) {
										$('#editClub_name').next('div[class="validation"]').text('This club name has been taken.');
									} else {
										$('#editClub_name').next('div[class="validation"]').text('');	
									}
									break;
								case 'editClub_address' :
									if(value.length == 0){
										$('#editClub_address').next('div[class="validation"]').text('An address is required.');
									} else {
										$('#editClub_address').next('div[class="validation"]').text('');	
									}
									break;
								case 'editClub_city' :
									if(value.length == 0){
										$('#editClub_city').next('div[class="validation"]').text('A city is required.');
									} else {
										$('#editClub_city').next('div[class="validation"]').text('');	
									}
									break;
								case 'editClub_state' :
									if(value.length == 0){
										$('#editClub_state').next('div[class="validation"]').text('A state is required.');
									} else {
										$('#editClub_state').next('div[class="validation"]').text('');	
									}
									break;
								case 'editClub_zip' :
									if(value.length == 0){
										$('#editClub_zip').next('div[class="validation"]').text('A zip is required.');
									} else {
										$('#editClub_zip').next('div[class="validation"]').text('');	
									}
									break;
								case 'editClub_password' :
									if(value.length == 0){
										$('#editClub_password').next('div[class="validation"]').text('A password is required.');
									} else {
										$('#editClub_password').next('div[class="validation"]').text('');	
									}
									break;
								default: 
									break;
							}
						});
						$('#editClubSubmit').unbind();

						$('#editClubSubmit').click(function(e){
							e.preventDefault();
							e.stopPropagation();
							validatorInstance.collectClubData(editClubs_existingClubs, currentClub);
						});
					</script>
				</div>
				<div class='span6'>
					<button id="cancelClubSubmit" class='btn btn-primary' type='button'>Cancel</button>
					<script>
						$('#cancelClubSubmit').click(function(e){
							$("#addEditClubsBlock").load('uploadClubs.php');
						});
					</script>
				</div>
			</div>
		</div>
	</form>	
<?php

} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){
		$id = mysql_real_escape_string(htmlspecialchars($_POST['id']));
		$n = mysql_real_escape_string(htmlspecialchars($_POST['editClub_name']));
		$a = mysql_real_escape_string(htmlspecialchars($_POST['editClub_address']));
		$c = mysql_real_escape_string(htmlspecialchars($_POST['editClub_city']));
		$s = mysql_real_escape_string(htmlspecialchars($_POST['editClub_state']));
		$z = mysql_real_escape_string(htmlspecialchars($_POST['editClub_zip']));
		$p = mysql_real_escape_string(htmlspecialchars($_POST['editClub_password']));


		$newClub = Club::newClub($n, $a, $c, $s, $z, $p);
		$newClub->id = $id;
		if($newClub->save()){
			redirect_to("clubListing.php");
		} else {
			die("Cannot register club. " . mysql_error());
		}
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}

?>